import { useMemo, useState, type ReactNode, type Ref } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
export interface SortField<T> {
  key: string;
  label: string;
  value: (row: T) => string | number;
}
interface Preferences {
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
}
const sizes = [10, 20, 50, 100];
function preferences(key: string, fallback: string): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(`ssot.list.${key}`) || "null");
    return {
      pageSize: sizes.includes(raw?.pageSize) ? raw.pageSize : 20,
      sort: typeof raw?.sort === "string" ? raw.sort : fallback,
      direction: raw?.direction === "desc" ? "desc" : "asc",
    };
  } catch {
    return { pageSize: 20, sort: fallback, direction: "asc" };
  }
}
export function useRecordList<T>({
  listKey,
  items,
  search,
  sortFields,
  scope = "",
}: {
  listKey: string;
  items: T[];
  search: (row: T) => string;
  sortFields: SortField<T>[];
  scope?: string;
}) {
  const initial = useMemo(
    () => preferences(listKey, sortFields[0].key),
    [listKey],
  );
  const [saved, setSaved] = useState({ key: listKey, value: initial });
  const value = saved.key === listKey ? saved.value : initial;
  const [filter, setFilter] = useState({ key: listKey, query: "" });
  const query = filter.key === listKey ? filter.query : "";
  const [pageState, setPage] = useState({ scope: "", index: 1 });
  const sort = sortFields.some((f) => f.key === value.sort)
    ? value.sort
    : sortFields[0].key;
  const update = (next: Partial<Preferences>) => {
    const v = { ...value, ...next };
    setSaved({ key: listKey, value: v });
    try {
      localStorage.setItem(`ssot.list.${listKey}`, JSON.stringify(v));
    } catch {
      /* Read-only storage does not block the list. */
    }
  };
  const matched = items.filter((row) =>
    search(row).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const field = sortFields.find((f) => f.key === sort)!;
  matched.sort((a, b) => {
    const x = field.value(a),
      y = field.value(b);
    const n =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "zh-CN", { numeric: true });
    return value.direction === "asc" ? n : -n;
  });
  const pages = Math.max(1, Math.ceil(matched.length / value.pageSize));
  const pageScope = `${listKey}|${query}|${scope}|${sort}|${value.direction}|${value.pageSize}`;
  const page =
    pageState.scope === pageScope ? Math.min(pageState.index, pages) : 1;
  const from = matched.length ? (page - 1) * value.pageSize + 1 : 0;
  const to = Math.min(page * value.pageSize, matched.length);
  return {
    query,
    setQuery: (q: string) => setFilter({ key: listKey, query: q }),
    page,
    pages,
    from,
    to,
    total: matched.length,
    rows: matched.slice((page - 1) * value.pageSize, page * value.pageSize),
    pageSize: value.pageSize,
    setPageSize: (n: number) => update({ pageSize: n }),
    sort,
    setSort: (s: string) => update({ sort: s }),
    direction: value.direction,
    toggleDirection: () =>
      update({ direction: value.direction === "asc" ? "desc" : "asc" }),
    go: (n: number) =>
      setPage({ scope: pageScope, index: Math.max(1, Math.min(n, pages)) }),
    sortFields,
  };
}
export type ListState<T> = ReturnType<typeof useRecordList<T>>;
export function ListToolbar<T>({
  list,
  children,
  label = "记录",
  inputRef,
}: {
  list: ListState<T>;
  children?: ReactNode;
  label?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="list-toolbar">
      <div className="list-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label={`搜索${label}`}
          placeholder={`搜索${label}…`}
          value={list.query}
          onChange={(e) => list.setQuery(e.target.value)}
        />
      </div>
      {children}
      <select
        aria-label={`${label}排序字段`}
        value={list.sort}
        onChange={(e) => list.setSort(e.target.value)}
      >
        {list.sortFields.map((f) => (
          <option value={f.key} key={f.key}>
            按{f.label}排序
          </option>
        ))}
      </select>
      <button
        className="sort-direction"
        aria-label={`${label}排序方向：${list.direction === "asc" ? "正序" : "逆序"}`}
        onClick={list.toggleDirection}
      >
        {list.direction === "asc" ? (
          <ArrowUp size={14} />
        ) : (
          <ArrowDown size={14} />
        )}{" "}
        {list.direction === "asc" ? "正序" : "逆序"}
      </button>
    </div>
  );
}
export function ListPagination<T>({
  list,
  label = "记录",
}: {
  list: ListState<T>;
  label?: string;
}) {
  return (
    <div className="list-pagination" aria-label={`${label}分页`}>
      <span>
        第 {list.from}–{list.to} 条，共 {list.total} 条
      </span>
      <label className="page-size">
        每页
        <select
          aria-label={`${label}每页条数`}
          value={list.pageSize}
          onChange={(e) => list.setPageSize(Number(e.target.value))}
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        条
      </label>
      <div className="page-buttons">
        <button
          aria-label={`${label}首页`}
          disabled={list.page === 1}
          onClick={() => list.go(1)}
        >
          <ChevronsLeft size={15} />
        </button>
        <button
          aria-label={`${label}上一页`}
          disabled={list.page === 1}
          onClick={() => list.go(list.page - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <span>
          {list.page} / {list.pages}
        </span>
        <button
          aria-label={`${label}下一页`}
          disabled={list.page === list.pages}
          onClick={() => list.go(list.page + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <button
          aria-label={`${label}末页`}
          disabled={list.page === list.pages}
          onClick={() => list.go(list.pages)}
        >
          <ChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}
export function RecordList<T>({
  listKey,
  items,
  search,
  sortFields,
  scope,
  children,
  filters,
  label = "记录",
  empty = "暂无记录",
  filtered = false,
  dimensions = [],
}: {
  listKey: string;
  items: T[];
  search: (row: T) => string;
  sortFields: SortField<T>[];
  scope?: string;
  children: (rows: T[]) => ReactNode;
  filters?: ReactNode;
  label?: string;
  empty?: string;
  filtered?: boolean;
  dimensions?: SortField<T>[];
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const narrowed = items.filter((row) =>
    dimensions.every(
      (d) => !selected[d.key] || String(d.value(row)) === selected[d.key],
    ),
  );
  const list = useRecordList({
    listKey,
    items: narrowed,
    search,
    sortFields,
    scope: `${scope || ""}|${JSON.stringify(selected)}`,
  });
  return (
    <div className="record-list">
      <ListToolbar list={list} label={label}>
        {filters}
        {dimensions.map((d) => (
          <select
            key={d.key}
            aria-label={`${label}${d.label}筛选`}
            value={selected[d.key] || ""}
            onChange={(e) =>
              setSelected((v) => ({ ...v, [d.key]: e.target.value }))
            }
          >
            <option value="">全部{d.label}</option>
            {Array.from(new Set(items.map((row) => String(d.value(row)))))
              .sort((a, b) => a.localeCompare(b, "zh-CN"))
              .map((value) => (
                <option key={value} value={value}>
                  {value || "未填写"}
                </option>
              ))}
          </select>
        ))}
      </ListToolbar>
      {list.rows.length ? (
        children(list.rows)
      ) : (
        <p className="list-empty">
          {list.query || filtered || Object.values(selected).some(Boolean)
            ? "没有符合筛选条件的记录"
            : empty}
        </p>
      )}
      <ListPagination list={list} label={label} />
    </div>
  );
}
