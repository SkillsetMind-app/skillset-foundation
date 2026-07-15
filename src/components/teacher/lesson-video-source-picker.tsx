import { Link2, UploadCloud, type LucideIcon } from "lucide-react";

type LessonVideoSource = "youtube" | "upload";

const sourceOptions: Array<{
  value: LessonVideoSource;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "youtube",
    label: "YouTube link",
    description: "Paste a trusted YouTube or Vimeo video URL.",
    icon: Link2,
  },
  {
    value: "upload",
    label: "Video upload",
    description: "Upload a lesson video or live recording.",
    icon: UploadCloud,
  },
];

export function LessonVideoSourcePicker(props: {
  value: "youtube" | "upload" | null;
  disabled?: boolean;
  onChange: (next: "youtube" | "upload") => void;
}) {
  return (
    <div className="lesson-video-source-picker">
      <p className="lesson-video-source-picker__heading">Choose a video source</p>
      <div className="lesson-video-source-picker__options">
        {sourceOptions.map((option) => {
          const Icon = option.icon;
          const isActive = props.value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              className={`lesson-video-source-picker__option${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
              disabled={props.disabled}
              onClick={() => {
                if (!isActive) {
                  props.onChange(option.value);
                }
              }}
            >
              <Icon aria-hidden="true" size={18} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
