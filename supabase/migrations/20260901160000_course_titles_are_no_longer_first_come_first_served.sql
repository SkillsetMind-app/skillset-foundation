-- Dois criadores independentes não podiam vender cursos com o mesmo nome.
--
-- `uq_courses_title_key` é um índice único GLOBAL sobre `courses.title_key`, e
-- `title_key` é derivado do título. Consequência: o primeiro criador a publicar
-- "Public Speaking" tomava a palavra para a plataforma inteira, e todos os
-- outros — em storefronts diferentes, sem nenhuma relação entre si — batiam em
-- "A course with this title already exists. Choose a more specific name."
--
-- Numa marketplace multi-criador isso é errado: os títulos que mais colidem são
-- justamente os bons ("Time Management", "Mindfulness Basics", "Public
-- Speaking"), e não existe motivo para o segundo psicólogo a chegar ter de
-- renomear seu curso por causa do primeiro.
--
-- O que a unicidade realmente protege é a URL (/courses/<title_key>), não o
-- título. Então a URL passa a ganhar sufixo — `public-speaking-2` — e o título
-- exibido continua exatamente o que o professor escreveu. É o que WordPress,
-- Medium e GitHub fazem com slug repetido.
--
-- O índice único CONTINUA no lugar: ele é o guarda de corrida real. Esta função
-- só escolhe uma chave livre; se duas transações escolherem a mesma no mesmo
-- instante, a segunda ainda falha no índice, como deve.

create or replace function public.course_title_key_available(
  p_base text,
  p_exclude_course_id text default null
)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base text := btrim(coalesce(p_base, ''));
  v_candidate text;
  v_suffix int := 2;
begin
  if char_length(v_base) < 3 then
    raise exception 'Course title is not specific enough.';
  end if;

  v_candidate := v_base;

  -- 200 é teto de sanidade, não de produto: chegar aqui significa 200 cursos
  -- publicados com o mesmo título, e aí o problema é outro.
  while v_suffix <= 200 loop
    if not exists (
      select 1
      from public.courses c
      where c.title_key = v_candidate
        and (p_exclude_course_id is null or c.id <> p_exclude_course_id)
    ) then
      return v_candidate;
    end if;

    -- `title_key` tem limite de tamanho na origem (course_title_key), então o
    -- sufixo entra depois de aparar o suficiente para caber.
    v_candidate := left(v_base, 120 - (char_length(v_suffix::text) + 1))
                   || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  raise exception 'Too many courses share this title. Choose a different name.';
end;
$function$;

revoke all on function public.course_title_key_available(text, text) from public;
grant execute on function public.course_title_key_available(text, text) to authenticated, service_role;

comment on function public.course_title_key_available(text, text) is
  'Primeira URL livre a partir de um title_key base, com sufixo -2, -3, … '
  'Existe para que o título de um criador não bloqueie o de outro.';

-- Troca os dois bloqueios pela escolha de uma URL livre.
--
-- Patch textual sobre a definição viva, e não uma cópia das funções: elas têm
-- ~200 linhas cada e reescrevê-las aqui criaria duas fontes da verdade que
-- divergem no primeiro `create or replace` futuro. O regex tolera espaço e
-- quebra de linha (os corpos gravados usam CRLF), e a migration ABORTA se o
-- padrão não casar — silêncio aqui significaria criador ainda bloqueado.
DO $patch$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_patched int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_teacher_course_draft', 'update_teacher_course_builder')
      AND pg_get_functiondef(p.oid) LIKE '%A course with this title already exists%'
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- Criação: nada a excluir, o curso ainda não existe.
    v_new := regexp_replace(
      v_def,
      'if\s+exists\s*\(\s*select\s+1\s+from\s+public\.courses\s+c\s+where\s+c\.title_key\s*=\s*v_title_key\s*\)\s*then\s*raise\s+exception\s*''[^'']*'';\s*end\s+if;',
      'v_title_key := public.course_title_key_available(v_title_key, null);',
      'gi'
    );

    -- Renomeação: o próprio curso não conta como colisão consigo mesmo.
    v_new := regexp_replace(
      v_new,
      'if\s+exists\s*\(\s*select\s+1\s+from\s+public\.courses\s+c\s+where\s+c\.title_key\s*=\s*v_title_key\s+and\s+c\.id\s*<>\s*p_course_id\s*\)\s*then\s*raise\s+exception\s*''[^'']*'';\s*end\s+if;',
      'v_title_key := public.course_title_key_available(v_title_key, p_course_id);',
      'gi'
    );

    IF v_new = v_def THEN
      RAISE EXCEPTION
        'course title suffixing: guard not found in %(). Aborting rather than leaving creators blocked by each other.',
        r.proname;
    END IF;

    EXECUTE v_new;
    v_patched := v_patched + 1;
  END LOOP;

  IF v_patched <> 2 THEN
    RAISE EXCEPTION
      'course title suffixing: expected to patch 2 functions, patched %.', v_patched;
  END IF;
END;
$patch$;

-- Prova, na própria migration: nenhuma das duas pode continuar recusando um
-- título por causa do curso de outro criador.
DO $verify$
DECLARE
  v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('create_teacher_course_draft', 'update_teacher_course_builder')
    AND pg_get_functiondef(p.oid) LIKE '%A course with this title already exists%';

  IF v_left > 0 THEN
    RAISE EXCEPTION
      '% function(s) still block a duplicate course title.', v_left;
  END IF;
END;
$verify$;
