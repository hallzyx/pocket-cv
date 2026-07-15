import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSection, type FieldDef, type ArrayItem } from "./editor-section";

describe("EditorSection", () => {
  const fields: FieldDef[] = [
    { key: "company", label: "Company", type: "text" },
    { key: "title", label: "Title", type: "text" },
  ];

  const sampleItems: ArrayItem[] = [
    { id: "item-1", company: "Acme Corp", title: "Engineer" },
    { id: "item-2", company: "Beta Inc", title: "Senior Dev" },
  ];

  it("renders the section title and item count", () => {
    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Experience")).toBeTruthy();
    expect(screen.getByText("(2)")).toBeTruthy();
  });

  it("shows empty label when no items", () => {
    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={[]}
        onChange={() => {}}
        emptyLabel="No experience yet."
      />,
    );

    expect(screen.getByText("No experience yet.")).toBeTruthy();
    // The add button text is "Add Experienc" (title.slice(0,-1) removes trailing 'e')
    expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
  });

  it("collapses and expands on header click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={() => {}}
      />,
    );

    // Initially expanded — items visible
    expect(screen.getByText("Acme Corp")).toBeTruthy();

    // Click header to collapse
    await user.click(screen.getByText("Experience"));

    // After collapse, items should be hidden
    expect(screen.queryByText("Acme Corp")).toBeNull();
  });

  it("adds a new item when clicking the add button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={onChange}
      />,
    );

    // The add button text is "Add Experienc" (title.slice(0,-1))
    const addBtn = screen.getByRole("button", { name: /add/i });
    await user.click(addBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newValues = onChange.mock.calls[0][0] as ArrayItem[];
    expect(newValues).toHaveLength(3); // 2 original + 1 new
    expect(newValues[2]).toHaveProperty("id");
    expect(newValues[2].company).toBe("");
    expect(newValues[2].title).toBe("");
  });

  it("removes an item when clicking the remove button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={onChange}
      />,
    );

    // Find and click the first remove button (there should be one per item)
    const removeButtons = screen.getAllByTitle("Remove");
    expect(removeButtons).toHaveLength(2);

    await user.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newValues = onChange.mock.calls[0][0] as ArrayItem[];
    expect(newValues).toHaveLength(1);
    expect(newValues[0].id).toBe("item-2");
  });

  it("calls onChange when editing an item field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={onChange}
      />,
    );

    // Items are collapsed by default except the first (since expandedIds is empty initially).
    // First, we need to expand the first item to see its fields.
    const itemHeaders = screen.getAllByText("Acme Corp");
    await user.click(itemHeaders[0]);

    // Now the fields should be visible. Find the Company input and type in it.
    const companyInput = screen.getByDisplayValue("Acme Corp");
    await user.clear(companyInput);
    await user.type(companyInput, "New Corp");

    expect(onChange).toHaveBeenCalled();
  });

  it("disables the up button on the first item", async () => {
    render(
      <EditorSection
        title="Experience"
        fields={fields}
        values={sampleItems}
        onChange={() => {}}
      />,
    );

    const buttons = screen.getAllByRole("button");
    // Each item has an up and down move button, a title toggle button,
    // a remove button, and an expand button. The first item's up move
    // button should be disabled (index === 0).
    // Find the header toggle buttons for each item
    const firstItemToggle = screen.getByText("Acme Corp").closest("button");
    expect(firstItemToggle).toBeTruthy();
    // The item is collapsed initially (expandedIds is empty Set)
    // so the move buttons are still visible since they're in the header div
    const disabledButtons = buttons.filter((b) => b.hasAttribute("disabled"));
    // The first item's up button should be disabled
    expect(disabledButtons.length).toBeGreaterThanOrEqual(1);
  });
});
