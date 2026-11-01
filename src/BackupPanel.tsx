import { useState } from "react";
import { command } from "./api";
import { RecordList } from "./components/RecordList";
import type { Snapshot } from "./model";
interface Backup {
  id: string;
  at: string;
  count: number;
}
export default function BackupPanel({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (s: Snapshot) => void;
}) {
  const [items, setItems] = useState<Backup[]>([]),
    [loaded, setLoaded] = useState(false),
    [preview, setPreview] = useState<{ s: Snapshot; revision: number } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-card wide">
      <h2>本地备份恢复点</h2>
      <p>
        删除、同步替换和新建空间前保留的副本。浏览器副本仍受清除网站数据影响，请另行导出。
      </p>
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            setItems(await command<Backup[]>("list_backups"));
            setLoaded(true);
          })
        }
      >
        读取本地备份
      </button>
      {loaded && (
        <RecordList
          listKey="backups"
          label="本地备份"
          items={items}
          search={(b) => `${b.id} ${b.at}`}
          sortFields={[
            { key: "at", label: "时间", value: (b) => b.at },
            { key: "count", label: "资产数", value: (b) => b.count },
          ]}
          empty="暂无本地备份"
        >
          {(rows) =>
            rows.map((b) => (
              <div className="import-preview-row" key={b.id}>
                <span>
                  {b.at || "空台账"} · {b.count} 项
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setPreview({
                        s: await command<Snapshot>("read_backup", { id: b.id }),
                        revision: snapshot.revision,
                      });
                    })
                  }
                >
                  预览恢复
                </button>
              </div>
            ))
          }
        </RecordList>
      )}
      {preview && (
        <div className="sync-preview">
          <p>
            将用备份中的 {preview.s.assets.length}{" "}
            项资产替换当前台账；替换前再次备份。
          </p>
          <button disabled={busy} onClick={() => setPreview(null)}>
            取消
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                onChange(
                  await command<Snapshot>("replace_snapshot", {
                    snapshot: preview.s,
                    revision: preview.revision,
                  }),
                );
                setPreview(null);
                setLoaded(false);
              })
            }
          >
            确认备份并恢复
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
