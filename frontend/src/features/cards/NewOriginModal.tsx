import { useCreateOrigin, type Origin } from "@/api/hooks/useOrigins";
import type { Catalog } from "@/catalog/useCatalog";
import { OriginForm } from "@/features/origins/OriginForm";
import { emptyOrigin } from "@/features/origins/originValues";
import { Modal } from "@/ui/Modal";

interface NewOriginModalProps {
  open: boolean;
  catalog: Catalog;
  onClose: () => void;
  /** Called once the origin exists and the origin list holds it. */
  onCreated: (origin: Origin) => void;
}

/** The origin editor in a modal, so a card can get a new origin without leaving its editor. */
export function NewOriginModal({ open, catalog, onClose, onCreated }: NewOriginModalProps) {
  const create = useCreateOrigin();
  return (
    <Modal open={open} title="New origin" onClose={onClose} size="lg">
      <OriginForm
        catalog={catalog}
        initial={emptyOrigin(catalog)}
        submitLabel="Create origin"
        onSubmit={async (body) => {
          // Resolves after the origin list has refetched, so the new option is there to select.
          onCreated(await create.mutateAsync(body));
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}
