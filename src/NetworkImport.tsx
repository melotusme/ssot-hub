import { useState } from "react";
import { RecordList } from "./components/RecordList";
import {
  networkCandidates,
  candidateAsset,
  type Candidate,
} from "./network-import";
import type { Asset, Snapshot } from "./model";
export default function NetworkImport({
  snapshot,
  apply,
  busy,
  error,
}: {
  snapshot: Snapshot;
  apply: (assets: Asset[]) => void;
  busy: boolean;
  error: string;
}) {
  const [text, setText] = useState(""),
    [source, setSource] = useState("家庭主路由器 DHCP 清单"),
    [observed, setObserved] = useState(new Date().toISOString());
  const [rows, setRows] = useState<Candidate[]>([]),
    [selection, setSelection] = useState<
      Record<string, "device" | "environment">
    >({}),
    [localError, setError] = useState("");
  return (
    <>
      <p className="muted">
        粘贴只读获取的 DHCP leases 或 JSON
        数组（mac、ip_addr、hostname/comment）。路由器看不到离线硬件、硬盘或登录账号；不要把虚拟机当成实体设备。默认不勾选。
      </p>
      <label>
        发现来源
        <input value={source} onChange={(e) => setSource(e.target.value)} />
      </label>
      <label>
        实际观测时间（ISO 8601，旧文件填原时间）
        <input value={observed} onChange={(e) => setObserved(e.target.value)} />
      </label>
      <label>
        网络清单
        <textarea
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows([]);
            setSelection({});
          }}
          placeholder='[{"mac":"02:00:00:00:00:01","ip_addr":"192.168.1.2","hostname":"example"}]'
        />
      </label>
      <button
        disabled={busy || !text.trim()}
        onClick={() => {
          try {
            setRows(networkCandidates(text));
            setSelection({});
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        解析并预览候选
      </button>
      {rows.length > 0 && (
        <RecordList
          listKey="network.candidates"
          label="发现候选"
          items={rows}
          search={(c) => `${c.name} ${c.mac} ${c.ip}`}
          sortFields={[
            { key: "name", label: "名称", value: (c) => c.name },
            { key: "ip", label: "IP", value: (c) => c.ip },
          ]}
          dimensions={[
            {
              key: "type",
              label: "候选类型",
              value: (c) =>
                c.suggestedKind === "environment" ? "疑似虚拟机" : "未确认设备",
            },
          ]}
        >
          {(page) =>
            page.map((c) => (
              <div className="candidate-row" key={c.mac}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!selection[c.mac]}
                    onChange={(e) =>
                      setSelection((old) => {
                        const next = { ...old };
                        if (e.target.checked) next[c.mac] = c.suggestedKind;
                        else delete next[c.mac];
                        return next;
                      })
                    }
                  />
                  {c.name}
                </label>
                <code>
                  {c.ip} · {c.mac}
                </code>
                <small>{c.warning}</small>
                <select
                  aria-label={`${c.name}登记类型`}
                  disabled={!selection[c.mac]}
                  value={selection[c.mac] || c.suggestedKind}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      [c.mac]: e.target.value as "device" | "environment",
                    })
                  }
                >
                  <option value="device">实体设备（已确认）</option>
                  <option value="environment">虚拟机 / 系统环境</option>
                </select>
              </div>
            ))
          }
        </RecordList>
      )}
      {(localError || error) && (
        <p role="alert" className="form-error">
          {localError || error}
        </p>
      )}
      <div className="dialog-foot">
        <span>已选 {Object.keys(selection).length} 项（跨分页保留）</span>
        <button
          className="primary"
          disabled={busy || !Object.keys(selection).length}
          onClick={() => {
            try {
              if (!source.trim() || !Number.isFinite(Date.parse(observed)))
                throw Error("请填写来源和有效观测时间");
              apply(
                rows
                  .filter((c) => selection[c.mac])
                  .map((c) =>
                    candidateAsset(
                      c,
                      selection[c.mac],
                      snapshot,
                      new Date(observed).toISOString(),
                      source,
                    ),
                  ),
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          确认登记所选候选
        </button>
      </div>
    </>
  );
}
