import { useRef, useState } from "react";

import { errorMessage } from "@/api/errors";
import { useRevokeShare, useShare, type ShareKind } from "@/api/hooks/useShare";
import { log } from "@/log/logger";
import { Button } from "@/ui/Button";
import { ErrorAlert } from "@/ui/ErrorAlert";
import { Modal } from "@/ui/Modal";
import { TextField } from "@/ui/TextField";

import { shareLink } from "./shareLink";

export interface ShareTarget {
  kind: ShareKind;
  id: string;
  name: string;
  /** The current code, or null when it isn't shared. */
  shareCode: string | null;
}

interface ShareDialogProps {
  target: ShareTarget | null;
  onClose: () => void;
  /** The builder has unsaved changes, which the link won't show until they're saved. */
  unsavedNote?: boolean;
}

/** Shares a deck or a card group by code and link, or revokes the code. */
export function ShareDialog({ target, onClose, unsavedNote = false }: ShareDialogProps) {
  return (
    <Modal open={target !== null} title={`Share ${target?.name ?? ""}`} onClose={onClose}>
      {target !== null && <ShareContent target={target} unsavedNote={unsavedNote} />}
    </Modal>
  );
}

function ShareContent({ target, unsavedNote }: { target: ShareTarget; unsavedNote: boolean }) {
  // The dialog's content mounts on every opening, so it starts from the item's current code.
  const [code, setCode] = useState(target.shareCode);
  const share = useShare(target.kind);
  const revoke = useRevokeShare(target.kind);

  return (
    <div className="flex flex-col gap-4">
      {unsavedNote && (
        <p className="text-sm text-text-muted">
          You have unsaved changes. The link shares the saved version.
        </p>
      )}
      {code === null ? (
        <>
          <p>
            Anyone with the link can preview it and import a copy. Your later edits show up in new
            imports.
          </p>
          {share.error !== null && <ErrorAlert>{errorMessage(share.error)}</ErrorAlert>}
          <div className="flex justify-end">
            <Button
              busy={share.isPending}
              onClick={() => {
                share.mutate(target.id, { onSuccess: setCode });
              }}
            >
              Create link
            </Button>
          </div>
        </>
      ) : (
        <SharedCode
          kind={target.kind}
          code={code}
          revoking={revoke.isPending}
          revokeError={revoke.error}
          onRevoke={() => {
            revoke.mutate(target.id, {
              onSuccess: () => {
                setCode(null);
              },
            });
          }}
        />
      )}
    </div>
  );
}

interface SharedCodeProps {
  kind: ShareKind;
  code: string;
  revoking: boolean;
  revokeError: Error | null;
  onRevoke: () => void;
}

function SharedCode({ kind, code, revoking, revokeError, onRevoke }: SharedCodeProps) {
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const link = shareLink(code);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch (error) {
      // Some browsers refuse the clipboard (permissions, an insecure page): the selected link
      // lets the user copy it by hand.
      log.warn("share.copy_failed", { kind }, error);
      linkRef.current?.select();
      setCopied("failed");
    }
  }

  if (confirmingRevoke) {
    return (
      <>
        <p>The link stops working. Sharing again makes a new code.</p>
        {revokeError !== null && <ErrorAlert>{errorMessage(revokeError)}</ErrorAlert>}
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmingRevoke(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" busy={revoking} onClick={onRevoke}>
            Revoke link
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Share code</p>
        <p className="font-mono text-3xl tracking-widest">{code}</p>
      </div>
      <TextField
        ref={linkRef}
        label="Link"
        value={link}
        readOnly
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      <p role="status" className="text-sm text-text-muted">
        {copied === "yes" && "Copied"}
        {copied === "failed" && "Couldn't copy the link. It's selected: copy it by hand."}
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            setConfirmingRevoke(true);
          }}
        >
          Revoke
        </Button>
        <Button onClick={() => void copyLink()}>Copy link</Button>
      </div>
    </>
  );
}
