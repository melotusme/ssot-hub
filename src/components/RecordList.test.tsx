// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { RecordList } from "./RecordList";
const items = Array.from({ length: 45 }, (_, i) => ({
  name: `Item ${String(i + 1).padStart(2, "0")}`,
}));
function Collection({ listKey = "test" }: { listKey?: string }) {
  return (
    <RecordList
      listKey={listKey}
      items={items}
      search={(r) => r.name}
      sortFields={[{ key: "name", label: "名称", value: (r) => r.name }]}
    >
      {(rows) => (
        <ul>
          {rows.map((r) => (
            <li key={r.name}>{r.name}</li>
          ))}
        </ul>
      )}
    </RecordList>
  );
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("共享列表规范", () => {
  it("默认每页20条，对整个数据集筛选并能到末页", async () => {
    const user = userEvent.setup();
    render(<Collection />);
    expect(screen.getByText("第 1–20 条，共 45 条")).toBeInTheDocument();
    expect(screen.queryByText("Item 45")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("记录末页"));
    expect(screen.getByText("第 41–45 条，共 45 条")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索记录"), "Item 01");
    expect(screen.getByText("第 1–1 条，共 1 条")).toBeInTheDocument();
    expect(screen.getByText("Item 01")).toBeInTheDocument();
  });
  it("维度筛选在全量数据上生效，空结果有明确提示", async () => {
    const user = userEvent.setup();
    render(
      <RecordList
        listKey="facets"
        items={items}
        search={(r) => r.name}
        sortFields={[{ key: "name", label: "名称", value: (r) => r.name }]}
        dimensions={[
          {
            key: "group",
            label: "分组",
            value: (r) => (r.name.endsWith("45") ? "末项" : "其他"),
          },
        ]}
      >
        {(rows) => (
          <ul>
            {rows.map((r) => (
              <li key={r.name}>{r.name}</li>
            ))}
          </ul>
        )}
      </RecordList>,
    );
    await user.selectOptions(screen.getByLabelText("记录分组筛选"), "末项");
    expect(screen.getByText("第 1–1 条，共 1 条")).toBeInTheDocument();
    expect(screen.getByText("Item 45")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索记录"), "missing");
    expect(screen.getByText("没有符合筛选条件的记录")).toBeInTheDocument();
  });
  it("保存页大小和排序方向，每个列表独立恢复", async () => {
    const user = userEvent.setup();
    const view = render(<Collection />);
    await user.selectOptions(screen.getByLabelText("记录每页条数"), "10");
    await user.click(screen.getByLabelText("记录排序方向：正序"));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Item 45");
    view.unmount();
    render(<Collection />);
    expect(screen.getByLabelText("记录每页条数")).toHaveValue("10");
    expect(screen.getByLabelText("记录排序方向：逆序")).toBeInTheDocument();
    cleanup();
    render(<Collection listKey="another" />);
    expect(screen.getByLabelText("记录每页条数")).toHaveValue("20");
    expect(screen.getByLabelText("记录排序方向：正序")).toBeInTheDocument();
  });
});
