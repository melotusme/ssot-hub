import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { pastedImages } from "./AiImport";

interface QuickCaptureProps {
  /** Hand the material to the AI dialog. */
  submit: (text: string, pasted: string[]) => void;
  /** Open the manual form instead. */
  manual: () => void;
}

/** The overview's main input: one sentence or a pasted screenshot. */
export default function QuickCapture({ submit, manual }: QuickCaptureProps) {
  const [text, setText] = useState("");
  const [pasted, setPasted] = useState<string[]>([]);
  const send = () => {
    if (!text.trim() && !pasted.length) return;
    submit(text, pasted);
    setText("");
    setPasted([]);
  };
  return (
    <section className="panel quick-capture">
      <label htmlFor="quick-capture">
        <Sparkles size={16} /> 说一句，或粘贴一张截图
      </label>
      <textarea
        id="quick-capture"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={async (e) => {
          const got = await pastedImages(e);
          if (got.length) setPasted((old) => [...old, ...got].slice(0, 4));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder="例如：新买了 iPad Air 给孩子上网课用，2999 元；Claude 会员不续了"
      />
      {pasted.length > 0 && (
        <ul className="ai-images">
          {pasted.map((d, i) => (
            <li key={d.slice(-32)}>
              <img src={d} alt={`粘贴的截图 ${i + 1}`} />
              <button
                type="button"
                className="icon-button"
                aria-label={`移除粘贴的截图 ${i + 1}`}
                onClick={() => setPasted(pasted.filter((x) => x !== d))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="quick-capture-actions">
        <button type="button" className="text-button" onClick={manual}>
          手动登记
        </button>
        <button
          className="primary"
          disabled={!text.trim() && !pasted.length}
          onClick={send}
        >
          交给 AI 整理（⌘↩）
        </button>
      </div>
    </section>
  );
}
