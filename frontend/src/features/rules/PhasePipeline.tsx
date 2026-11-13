import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import type { UseFieldArrayReturn } from "react-hook-form";

import { findModule, type Catalog } from "@/catalog/useCatalog";
import { DRAG_DISTANCE_PX } from "@/ui/dragDistance";

import { PhaseItem } from "./PhaseItem";
import type { Pipeline } from "./phaseList";
import { usePlacedRuleErrors } from "./ruleErrorsContext";
import type { RulesFormValues } from "./rulesetValues";

interface PhasePipelineProps {
  pipeline: Pipeline;
  title: string;
  hint: string;
  phases: UseFieldArrayReturn<RulesFormValues, Pipeline>;
  catalog: Catalog;
  readOnly: boolean;
}

/**
 * One phase list, in order. Phases are reordered by dragging their handle (the pointer only) or
 * with their Move buttons; each list has its own drag area, so a phase stays in its pipeline.
 */
export function PhasePipeline({
  pipeline,
  title,
  hint,
  phases,
  catalog,
  readOnly,
}: PhasePipelineProps) {
  const { fields, move, remove } = phases;
  const problems = usePlacedRuleErrors().pipelines.get(pipeline) ?? [];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
  );
  const headingId = `${pipeline}-phases-title`;

  const indexOf = (id: UniqueIdentifier) => fields.findIndex((field) => field.id === id);
  const nameAt = (index: number) => {
    const key = fields[index]?.key ?? "";
    return findModule(catalog.phases, key)?.name ?? key;
  };
  const position = (index: number) => `position ${index + 1} of ${fields.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameAt(indexOf(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : `${nameAt(indexOf(active.id))} is at ${position(indexOf(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${nameAt(indexOf(active.id))} was put back.`
        : `${nameAt(indexOf(active.id))} was moved to ${position(indexOf(over.id))}.`,
    onDragCancel: ({ active }) => `${nameAt(indexOf(active.id))} was put back.`,
  };

  function moveTo(from: number, to: number) {
    setAnnouncement(`${nameAt(from)} was moved to ${position(to)}.`);
    move(from, to);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over === null || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    if (from >= 0 && to >= 0) move(from, to);
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div>
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold">
          {title}
        </h3>
        <p className="text-sm text-text-muted">{hint}</p>
      </div>
      {problems.length > 0 && (
        <ul aria-label={`${title} problems`} className="text-sm text-danger">
          {problems.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {fields.length === 0 ? (
        <p className="text-sm text-text-muted">No {title.toLowerCase()} phases.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{ announcements }}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={fields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol aria-labelledby={headingId} className="flex flex-col gap-2">
              {fields.map((field, index) => (
                <PhaseItem
                  key={field.id}
                  id={field.id}
                  pipeline={pipeline}
                  index={index}
                  count={fields.length}
                  phaseKey={field.key}
                  catalog={catalog}
                  readOnly={readOnly}
                  onMove={(to) => {
                    moveTo(index, to);
                  }}
                  onRemove={() => {
                    setAnnouncement(`${nameAt(index)} was removed.`);
                    remove(index);
                    // The removed phase had the focus; the list's heading takes it.
                    headingRef.current?.focus();
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
