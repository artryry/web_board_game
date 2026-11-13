import { useSortable } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, ChevronDown, CircleAlert, GripVertical, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useWatch } from "react-hook-form";

import { parseSchema, describeParams } from "@/catalog/schemaFields";
import { SchemaForm } from "@/catalog/SchemaForm";
import { findModule, type Catalog } from "@/catalog/useCatalog";
import { IconButton } from "@/ui/IconButton";

import type { Pipeline } from "./phaseList";
import { usePlacedRuleErrors } from "./ruleErrorsContext";
import type { RulesFormValues } from "./rulesetValues";

interface PhaseItemProps {
  /** The sortable id: the form's id for this row, which follows it when the list is reordered. */
  id: string;
  pipeline: Pipeline;
  index: number;
  count: number;
  phaseKey: string;
  catalog: Catalog;
  readOnly: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}

/**
 * One phase of a pipeline: its name and params at a glance, its settings when expanded, and the
 * buttons that move or remove it. A phase the catalog no longer knows can only be removed.
 */
export function PhaseItem(props: PhaseItemProps) {
  const { id, pipeline, index, count, phaseKey, catalog, readOnly, onMove, onRemove } = props;
  const spec = findModule(catalog.phases, phaseKey);
  const path = `${pipeline}.${index}` as const;
  const params = useWatch<RulesFormValues, `${Pipeline}.${number}.params`>({
    name: `${path}.params`,
  });
  const placed = usePlacedRuleErrors();
  const [open, setOpen] = useState(false);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // A phase the catalog doesn't know can only be removed.
  const movable = !readOnly && spec !== undefined;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id, disabled: !movable });

  const name = spec?.name ?? `Unknown phase “${phaseKey}”`;
  const hasSettings = spec !== undefined && parseSchema(spec.params_schema).length > 0;
  const summary = hasSettings ? describeParams(spec.params_schema, params ?? {}) : "";
  const timeLimit = spec?.interactive === true ? params?.time_limit_s : undefined;
  const messages = placed.phases.get(path) ?? [];
  const marked = placed.marked.has(path);

  function moveTo(to: number) {
    // At an end the pressed button turns disabled, which would drop focus; hand it to the other.
    if (to === 0) downRef.current?.focus();
    if (to === count - 1) upRef.current?.focus();
    onMove(to);
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform:
          transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
      }}
      className={`relative rounded-md border bg-surface ${marked ? "border-danger" : "border-border"} ${isDragging ? "z-10 opacity-80 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        {movable && (
          <span
            ref={setActivatorNodeRef}
            {...listeners}
            aria-hidden="true"
            data-drag-handle=""
            className="cursor-grab touch-none p-1 text-text-muted"
          >
            <GripVertical className="size-4" />
          </span>
        )}
        <p className="min-w-0 flex-1">
          <span aria-hidden="true" className="text-text-muted">
            {index + 1}.{" "}
          </span>
          <span className="font-medium">{name}</span>
          {summary !== "" && <span className="text-text-muted"> · {summary}</span>}
        </p>
        {typeof timeLimit === "number" && (
          <span className="shrink-0 text-sm text-text-muted">
            <span aria-hidden="true">⏱</span> {timeLimit} s
            <span className="sr-only"> time limit</span>
          </span>
        )}
        {marked && (
          <span className="shrink-0 text-danger">
            <CircleAlert aria-hidden="true" className="size-4" />
            <span className="sr-only">Has problems</span>
          </span>
        )}
        <div className="flex shrink-0">
          {hasSettings && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              title={`${name} settings`}
              onClick={() => {
                setOpen(!open);
              }}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-raised hover:text-text"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
              <span className="sr-only">{name} settings</span>
            </button>
          )}
          {movable && (
            <>
              <IconButton
                ref={upRef}
                label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => {
                  moveTo(index - 1);
                }}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton
                ref={downRef}
                label={`Move ${name} down`}
                disabled={index === count - 1}
                onClick={() => {
                  moveTo(index + 1);
                }}
              >
                <ArrowDown aria-hidden="true" className="size-4" />
              </IconButton>
            </>
          )}
          {!readOnly && (
            <IconButton label={`Remove ${name}`} onClick={onRemove}>
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          )}
        </div>
      </div>
      {messages.length > 0 && (
        <ul className="px-3 pb-2 text-sm text-danger">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {hasSettings && open && (
        <fieldset id={panelId} disabled={readOnly} className="border-t border-border px-3 py-3">
          <legend className="sr-only">{name} settings</legend>
          <SchemaForm schema={spec.params_schema} name={`${path}.params`} />
        </fieldset>
      )}
    </li>
  );
}
