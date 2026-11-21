import { useRef } from "react";

import { log } from "@/log/logger";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { useCopyText, type CopyStatus } from "@/ui/useCopyText";

/** The room's link: opening it joins the room (UC6). */
function roomLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

/** The invitation (UC6): the code to type in, and the link to open. */
export function InviteBox({ code }: { code: string }) {
  return (
    <section
      aria-labelledby="invite-title"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="invite-title" className="text-lg font-semibold">
        Invite a friend
      </h2>
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
        <CopyRow
          label="Room code"
          value={code}
          copyLabel="Copy code"
          what="code"
          inputClassName="w-44 font-mono text-2xl tracking-widest"
        />
        <CopyRow label="Link" value={roomLink(code)} copyLabel="Copy link" what="link" />
      </div>
    </section>
  );
}

interface CopyRowProps {
  label: string;
  value: string;
  copyLabel: string;
  what: "code" | "link";
  inputClassName?: string;
}

function CopyRow({ label, value, copyLabel, what, inputClassName = "" }: CopyRowProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const copyText = useCopyText((error) => {
    log.warn("room.copy_failed", { what }, error);
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            ref={fieldRef}
            label={label}
            value={value}
            readOnly
            className={`w-full ${inputClassName}`}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </div>
        <Button variant="secondary" onClick={() => void copyText.copy(value, fieldRef.current)}>
          {copyLabel}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-text-muted">
        {statusText(copyText.status, what)}
      </p>
    </div>
  );
}

function statusText(status: CopyStatus, what: "code" | "link"): string {
  if (status === "copied") return "Copied";
  if (status === "failed") return `Couldn't copy the ${what}. It's selected: copy it by hand.`;
  return "";
}
