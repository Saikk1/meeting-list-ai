export type AssistantOperationPreviewRow = {
  id: string;
  module: string;
  operation: string;
  target: string;
  change: string;
  tone?: "normal" | "warning" | "danger";
};

export type AssistantOperationPreviewProps = {
  rows: AssistantOperationPreviewRow[];
};

const TONE_LABELS: Record<
  Exclude<AssistantOperationPreviewRow["tone"], undefined | "normal">,
  string
> = {
  warning: "请留意",
  danger: "高风险",
};

export function AssistantOperationPreview({
  rows,
}: AssistantOperationPreviewProps) {
  if (!rows.length) {
    return (
      <div className="assistant-operation-preview__empty" role="status">
        暂无待执行的系统操作
      </div>
    );
  }

  return (
    <div className="assistant-operation-preview">
      <div className="assistant-operation-preview__frame">
        <table>
          <caption className="assistant-operation-preview__caption">
            系统操作预览，共 {rows.length} 项
          </caption>
          <thead>
            <tr>
              <th scope="col">模块</th>
              <th scope="col">操作</th>
              <th scope="col">对象</th>
              <th scope="col">变更</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = row.tone ?? "normal";
              const toneLabel = tone === "normal" ? null : TONE_LABELS[tone];

              return (
                <tr
                  key={row.id}
                  className={`assistant-operation-preview__row is-${tone}`}
                >
                  <td>
                    <span
                      className="assistant-operation-preview__mobile-label"
                      aria-hidden="true"
                    >
                      模块
                    </span>
                    <span className="assistant-operation-preview__module">
                      {row.module}
                    </span>
                  </td>
                  <td>
                    <span
                      className="assistant-operation-preview__mobile-label"
                      aria-hidden="true"
                    >
                      操作
                    </span>
                    <span className="assistant-operation-preview__operation">
                      {row.operation}
                      {toneLabel ? (
                        <span
                          className={`assistant-operation-preview__tone is-${tone}`}
                        >
                          {toneLabel}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    <span
                      className="assistant-operation-preview__mobile-label"
                      aria-hidden="true"
                    >
                      对象
                    </span>
                    <span className="assistant-operation-preview__target">
                      {row.target}
                    </span>
                  </td>
                  <td>
                    <span
                      className="assistant-operation-preview__mobile-label"
                      aria-hidden="true"
                    >
                      变更
                    </span>
                    <span className="assistant-operation-preview__change">
                      {row.change}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
