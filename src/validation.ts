import { fields, kinds, matchesRef, type Snapshot, type Asset } from "./model";

export function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== "object") throw Error("快照不是对象");
  const s = value as Snapshot;
  if (
    ![1, 2, 3].includes(s.version) ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.assets) ||
    !Array.isArray(s.links) ||
    !Array.isArray(s.events)
  )
    throw Error("不支持的快照格式 / 版本");
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (typeof id !== "string" || !id || ids.has(id))
      throw Error("ID 无效 / 重复");
    ids.add(id);
  };
  for (const a of s.assets) {
    if (
      !a ||
      !kinds.includes(a.kind) ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      a.name.length > 200 ||
      !["active", "retired"].includes(a.status) ||
      !a.fields ||
      typeof a.fields !== "object" ||
      Array.isArray(a.fields)
    )
      throw Error("资产名称、类型或状态无效");
    unique(a.id);
    for (const [key, v] of Object.entries(a.fields)) {
      const f = fields[a.kind].find((f) => f.key === key);
      if (!f && !["notes", "purpose", "secret_ref", "expires_on"].includes(key))
        throw Error(`不支持字段 ${key}，请勿录入密码或令牌`);
      if (typeof v !== "string" || v.length > 20000)
        throw Error("字段无效或过长");
      if (!v) continue;
      if (
        ["secret_ref", "license_ref"].includes(key) &&
        !/^(op|1password|vault|keychain|bw):\/\//.test(v)
      )
        throw Error("凭据仅允许保险库引用");
      if (
        (f?.type === "date" || key === "expires_on") &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          Number.isNaN(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        throw Error("日期应为有效的 YYYY-MM-DD");
      if (
        f?.ref &&
        (v === a.id ||
          !s.assets.some((t) => t.id === v && matchesRef(t.kind, f.ref)))
      )
        throw Error(`${key} 引用无效`);
      if (f?.options && !f.options.some((o) => o[0] === v))
        throw Error(`${key} 选项无效`);
      if (
        ["price", "exchange_rate"].includes(key) &&
        (!/^\d+(\.\d+)?$/.test(v) ||
          !Number.isFinite(Number(v)) ||
          (key === "exchange_rate" && Number(v) <= 0))
      )
        throw Error("金额必须非负，汇率必须大于零");
      if (["currency", "base_currency"].includes(key) && !/^[A-Z]{3}$/.test(v))
        throw Error("币种应为三位大写代码");
      if (
        ["repository", "authority_ref", "endpoint", "backup_ref", "path"].includes(
          key,
        ) &&
        (/\w+:\/\/[^/]*@/.test(v) || /(?:token|password|key|secret)=/i.test(v))
      )
        throw Error("地址不能包含凭据");
    }
    for (const f of fields[a.kind])
      if (
        (f.required || (a.kind === "software" && f.key === "environment_id")) &&
        !a.fields[f.key]
      )
        throw Error(`请填写${f.label}`);
    if (a.kind === "connection" && a.fields.probe_state && a.fields.probe_state !== "untested" &&
        (!a.fields.probe_at || Number.isNaN(Date.parse(a.fields.probe_at))))
      throw Error("标记连通性必须填写有效测试时间，配置存在不等于连通");
    if (a.kind === "connection" && a.fields.software_id) {
      const installation = s.assets.find(x=>x.id===a.fields.software_id);
      const env = s.assets.find(x=>x.id===installation?.fields.environment_id);
      if (a.fields.node_id !== env?.id && a.fields.node_id !== env?.fields.device_id)
        throw Error("网络节点与软件安装环境不一致；不能混淆宿主和客户机");
    }
    if (a.kind === "course") {
      const total = a.fields.lessons_total || "0",
        used = a.fields.lessons_used || "0";
      if (
        ![total, used].every(
          (v) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)),
        ) ||
        Number(used) > Number(total)
      )
        throw Error("课时须为非负整数，已用不能超过购买课时");
      if (
        a.fields.starts_on &&
        a.fields.expires_on &&
        a.fields.expires_on < a.fields.starts_on
      )
        throw Error("课程到期不能早于开始");
    }
    if (a.kind === "assignment") {
      if (a.fields.ends_on && a.fields.ends_on <= a.fields.starts_on)
        throw Error("使用结束日期必须晚于开始日期");
      if (a.status === "active")
        for (const b of s.assets) {
          if (
            b.id === a.id ||
            b.kind !== "assignment" ||
            b.status !== "active" ||
            b.fields.asset_id !== a.fields.asset_id
          )
            continue;
          if (
            a.fields.starts_on < (b.fields.ends_on || "9999-12-31") &&
            b.fields.starts_on < (a.fields.ends_on || "9999-12-31") &&
            (a.fields.person_id === b.fields.person_id ||
              a.fields.usage_role !== "shared" ||
              b.fields.usage_role !== "shared")
          )
            throw Error(
              "使用区间重叠：请交接或结束旧记录；多人同时使用须均为共用",
            );
        }
    }
    const seen = new Set<string>();
    let cursor: Asset | undefined = a;
    while (cursor) {
      if (seen.has(cursor.id)) throw Error("系统环境宿主关系存在循环");
      seen.add(cursor.id);
      cursor = s.assets.find((t) => t.id === cursor?.fields.host_id);
    }
  }
  const triples = new Set<string>();
  for (const l of s.links) {
    unique(l.id);
    const triple = JSON.stringify([l.from, l.to, l.relation]);
    if (
      l.from === l.to ||
      typeof l.relation !== "string" ||
      !l.relation.trim() ||
      !s.assets.some((a) => a.id === l.from) ||
      !s.assets.some((a) => a.id === l.to) ||
      triples.has(triple)
    )
      throw Error("关系端点或用途无效 / 重复");
    triples.add(triple);
  }
  const events = new Set<string>();
  for (const e of s.events) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      events.has(e.id) ||
      ![e.at, e.actor, e.action, e.detail].every((v) => typeof v === "string")
    )
      throw Error("审计记录无效 / 重复");
    events.add(e.id);
  }
}
