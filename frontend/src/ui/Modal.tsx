import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `lg` fits a whole editor form, like the origin editor. */
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-5xl" };

/**
 * A modal dialog on the native `<dialog>`: `showModal()` moves focus in, makes the page behind it
 * inert and closes on Esc. Render it outside any `<form>`, since it may hold a form of its own.
 */
export function Modal({ open, ...props }: ModalProps) {
  // Mounting only while open lets each opening start with fresh content.
  return open ? <OpenModal {...props} /> : null;
}

function OpenModal({ title, onClose, children, size = "md" }: Omit<ModalProps, "open">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // The dialog leaves the page when it closes, so the browser can't hand focus back to the
    // control that opened it; this does.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    // showModal() focuses the first control. A field the dialog exists for can ask for focus
    // with `data-autofocus` instead (React's autoFocus runs before the dialog opens).
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Esc fires `cancel`. The parent decides whether the dialog closes, so React stays in charge.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-lg border border-border-strong bg-surface p-6 text-text backdrop:bg-bg/80 ${SIZES[size]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-muted hover:text-text"
        >
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
