import type { Asset, Link, PlanItem } from "./model";

/** What the backend applies in one transaction (mirrors `store::Changes`). */
export interface Changes {
  create: Asset[];
  update: Asset[];
  link: Link[];
  /** [open use id, end date] */
  end_uses: [string, string][];
}

/** A relation cannot be applied when a new asset it points at is not selected. */
export function blockedBy(
  item: PlanItem,
  selected: Set<string>,
  items: PlanItem[],
): PlanItem[] {
  if (item.op !== "relate") return [];
  return item.needs
    .filter((k) => !selected.has(k))
    .map((k) => items.find((i) => i.key === k))
    .filter((i): i is PlanItem => !!i);
}

export function canApply(
  item: PlanItem,
  selected: Set<string>,
  items: PlanItem[],
): boolean {
  return item.ready && blockedBy(item, selected, items).length === 0;
}

/** Drop field values that point at new assets the user did not select. */
function detach(a: Asset, dropped: Set<string>): Asset {
  return {
    ...a,
    fields: Object.fromEntries(
      Object.entries(a.fields).filter(([, v]) => !dropped.has(v)),
    ),
  };
}

/** Turn the selected plan items into one set of changes. */
export function planToChanges(
  items: PlanItem[],
  selected: Set<string>,
): Changes {
  const chosen = items.filter(
    (i) => selected.has(i.key) && canApply(i, selected, items),
  );
  const dropped = new Set(
    items
      .filter((i) => i.op === "create" && !chosen.includes(i) && i.asset)
      .map((i) => i.asset!.id),
  );
  const create = chosen
    .filter((i) => i.op === "create" && i.asset)
    .map((i) => detach(i.asset!, dropped));
  // An update and a retire of the same asset become one change.
  const changed = new Map<string, Asset>();
  for (const i of chosen.filter((i) => i.op === "update" && i.asset))
    changed.set(i.asset!.id, detach(i.asset!, dropped));
  for (const i of chosen.filter((i) => i.op === "retire" && i.asset)) {
    const base = changed.get(i.asset!.id) ?? i.asset!;
    changed.set(i.asset!.id, { ...base, status: "retired" });
  }
  const relate = chosen.filter((i) => i.op === "relate" && i.link);
  return {
    create,
    update: [...changed.values()],
    link: relate.map((i) => i.link!),
    end_uses: relate
      .filter((i) => i.ends)
      .map((i): [string, string] => [i.ends!, i.link!.attrs.starts_on || ""]),
  };
}
