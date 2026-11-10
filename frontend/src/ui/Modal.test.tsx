import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

describe("Modal", () => {
  it("shows a titled dialog only while open", () => {
    const { rerender } = render(
      <Modal open={false} title="Move card" onClose={vi.fn()}>
        Body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <Modal open title="Move card" onClose={vi.fn()}>
        Body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Move card" })).toHaveTextContent("Body");
  });

  it("closes with its close button and with Esc", async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Move card" onClose={onClose}>
        Body
      </Modal>,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Esc fires `cancel` on a modal dialog; jsdom doesn't, so the test does.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("gives focus back to the control that opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(
      <Modal open title="Move card" onClose={vi.fn()}>
        <input aria-label="Name" data-autofocus />
      </Modal>,
    );
    expect(opener).not.toHaveFocus();

    rerender(
      <Modal open={false} title="Move card" onClose={vi.fn()}>
        <input aria-label="Name" data-autofocus />
      </Modal>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("focuses the field marked data-autofocus", () => {
    render(
      <Modal open title="New group" onClose={vi.fn()}>
        <input aria-label="Name" data-autofocus />
      </Modal>,
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });
});
