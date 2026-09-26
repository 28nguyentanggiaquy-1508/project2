"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeVideo, getModels } from "../services/api";
import { EllipsisVertical, X } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

export default function Home() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [videoFrameError, setVideoFrameError] = useState(false);

  const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";

  useEffect(() => {
    getModels()
      .then((res) => {
        setModels(res.models || []);
        setSelectedModelId(res.default_model_id || "");
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    setVideoFrameError(false);
  }, [data?.video_id]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  );

  const groupedModels = useMemo(
    () => ({
      inference: models.filter((model) => model.group === "inference"),
      sequence: models.filter((model) => model.group === "sequence"),
    }),
    [models]
  );

  const handleAnalyze = async () => {
    if (!url) return;

    setLoading(true);
    setData(null);

    try {
      const res = await analyzeVideo(url, selectedModelId);
      setData(res);
    } catch {
      setData({ error: "Lỗi gọi API" });
    }

    setLoading(false);
  };

  const sentimentColors = ["#4CAF50", "#FFC107", "#F44336"];

  const emotionColors: any = {
    ANGER: "#F44336",
    DISGUST: "#9C27B0",
    ENJOYMENT: "#4CAF50",
    FEAR: "#FF9800",
    OTHER: "#9E9E9E",
    SADNESS: "#2196F3",
    SURPRISE: "#FFC107",
  };

  const pieData = data
    ? [
      { name: "Positive", value: data.summary?.positive || 0 },
      { name: "Neutral", value: data.summary?.neutral || 0 },
      { name: "Negative", value: data.summary?.negative || 0 },
    ]
    : [];

  const barData = data?.emotions
    ? Object.entries(data.emotions).map(([k, v]) => ({
      name: k,
      value: v as number,
    }))
    : [];

  const contextKeywords = Array.isArray(data?.context?.keywords)
    ? data.context.keywords
    : [];

  const contextSourceLabel =
    data?.context?.source === "gemini_flash_vision"
      ? "Gemini Flash Vision"
      : data?.context?.source === "local_fallback"
        ? "Local fallback"
        : data?.context?.source || "Không xác định";

  const downloadJSON = () => {
    if (!data) return;

    const blob = new Blob(
      [JSON.stringify(data.comments, null, 2)],
      { type: "application/json" }
    );

    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "tiktok_comments.json";
    a.click();

    window.URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    if (!data) return;

    const headers = ["comment", "label", "all_labels", "confidence"];

    const rows = data.comments.map((c: any) => [
      `"${c.text.replace(/"/g, '""')}"`,
      c.label,
      `"${(c.all_labels || []).join("|")}"`,
      c.confidence ?? "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r: any) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "tiktok_comments.csv";
    a.click();

    window.URL.revokeObjectURL(url);
  };
  return (
    <div className="container" style={{ padding: 20, position: "relative" }}>

      {/* INPUT */}
      <div className="card" style={{ marginBottom: 20, position: "relative" }}>
        <button
          className="icon-btn top-right"
          onClick={() => setModelOpen(true)}
          title="Chọn model"
          type="button"
        >
          <EllipsisVertical size={22} />
        </button>
        <h2>Phân tích video TikTok</h2>

        {selectedModel && (
          <p style={{ margin: "4px 44px 14px 0", color: "#64748b", fontSize: 13 }}>
            Model: {selectedModel.name}
          </p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="input"
            placeholder="Dán link TikTok..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          <button className="btn" onClick={handleAnalyze}>
            {loading ? "Đang xử lý..." : "Analyze"}
          </button>
        </div>
      </div>

      {loading && <div className="card">Đang phân tích...</div>}

      {modelOpen && (
        <div className="modal-backdrop" onClick={() => setModelOpen(false)}>
          <div className="model-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Chọn model</h3>
              <button
                className="icon-btn"
                onClick={() => setModelOpen(false)}
                title="Đóng"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <div className="model-section">
              <h4>Inference</h4>
              {groupedModels.inference.map((model) => (
                <label
                  className={`model-option ${model.available === false ? "disabled" : ""}`}
                  key={model.id}
                >
                  <input
                    type="radio"
                    name="model"
                    checked={selectedModelId === model.id}
                    disabled={model.available === false}
                    onChange={() => setSelectedModelId(model.id)}
                  />
                  <span>
                    <b>{model.name}</b>
                    <small>{model.filename}</small>
                    {model.note && <small>{model.note}</small>}
                  </span>
                </label>
              ))}
            </div>

            <div className="model-section">
              <h4>Sequence</h4>
              {groupedModels.sequence.map((model) => (
                <label
                  className={`model-option ${model.available === false ? "disabled" : ""}`}
                  key={model.id}
                >
                  <input
                    type="radio"
                    name="model"
                    checked={selectedModelId === model.id}
                    disabled={model.available === false}
                    onChange={() => setSelectedModelId(model.id)}
                  />
                  <span>
                    <b>{model.name}</b>
                    <small>{model.filename}</small>
                    {model.note && <small>{model.note}</small>}
                  </span>
                </label>
              ))}
            </div>

            <button className="btn" onClick={() => setModelOpen(false)}>
              Áp dụng
            </button>
          </div>
        </div>
      )}

      {data?.error && (
        <div className="card" style={{ color: "red" }}>
          {data.error}
        </div>
      )}

      {data && !data.error && (
        <>
          {/* SUMMARY */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Tổng quan</h3>
            <p>Video ID: {data.video_id}</p>

            <div style={{ display: "flex", gap: 30 }}>
              <p>Positive: {data.summary.positive}</p>
              <p>Neutral: {data.summary.neutral}</p>
              <p>Negative: {data.summary.negative}</p>
            </div>
          </div>

          {/* CONTEXT */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h3>Ngữ cảnh video</h3>

            <div
              style={{
                display: "flex",
                gap: 40,
                flexWrap: "wrap",
                marginTop: 10,
              }}
            >
              <p>
                <b>Chủ đề:</b> {data.context?.topic || "Không xác định"}
              </p>

              <p>
                <b>Tông cảm xúc:</b> {data.context?.tone || "Không xác định"}
              </p>
            </div>

            <div style={{ marginTop: 12, lineHeight: 1.7 }}>
              {data.context?.visual_summary && (
                <p>
                  <b>Hình ảnh/video:</b> {data.context.visual_summary}
                </p>
              )}

              {data.context?.audience_context && (
                <p>
                  <b>Ngữ cảnh người xem:</b> {data.context.audience_context}
                </p>
              )}

              <p>
                <b>Nguồn ngữ cảnh:</b> {contextSourceLabel}
              </p>
            </div>

            {contextKeywords.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                {contextKeywords.map((keyword: string) => (
                  <span
                    key={keyword}
                    style={{
                      background: "#eef2ff",
                      color: "#3730a3",
                      padding: "5px 10px",
                      borderRadius: 999,
                      fontSize: 13,
                    }}
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            )}

            {/* OPTIONAL: hiện score */}
            {data.context?.scores && (
              <div style={{ marginTop: 15 }}>
                <p><b>Context Scores:</b></p>

                <div
                  style={{
                    display: "flex",
                    gap: 15,
                    flexWrap: "wrap",
                    marginTop: 8,
                  }}
                >
                  {Object.entries(data.context.scores).map(([k, v]: any) => (
                    <div
                      key={k}
                      style={{
                        background: "#f3f4f6",
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    >
                      {k}: {v}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* CHART */}
          <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>

            {/* PIE */}
            <div className="card" style={{ flex: 1 }}>
              <h3>Sentiment</h3>
              <PieChart width={300} height={250}>
                <Pie data={pieData} dataKey="value" outerRadius={100}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={sentimentColors[i]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </div>

            {/* BAR FIX LABEL */}
            <div className="card" style={{ flex: 1 }}>
              <h3>Emotions</h3>
              <BarChart width={400} height={250} data={barData}>
                <CartesianGrid strokeDasharray="3 3" />

                {/* FIX LABEL FULL */}
                <XAxis
                  dataKey="name"
                  interval={0}
                  tick={{ fontSize: 10 }}  // giảm size chữ
                />

                <YAxis />
                <Tooltip />

                <Bar dataKey="value">
                  {barData.map((entry: any, index: number) => (
                    <Cell
                      key={index}
                      fill={emotionColors[entry.name] || "#8884d8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </div>
          </div>

          {/* VIDEO + COMMENTS */}
          <div style={{ display: "flex", gap: 40, marginBottom: 20 }}>

            {/* VIDEO */}
            <div className="card" style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <h3 style={{ margin: 0 }}>Video</h3>
                <a
                  href={data.video_url || url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#2563eb", fontWeight: 600, fontSize: 13 }}
                >
                  Mở trên TikTok ↗
                </a>
              </div>

              {!videoFrameError ? (
                <video
                  key={data.video_id}
                  src={`${API_BASE_URL}/video/${data.video_id}?url=${encodeURIComponent(
                    data.video_url || url
                  )}`}
                  controls
                  preload="metadata"
                  playsInline
                  style={{
                    width: "100%",
                    height: 500,
                    borderRadius: 8,
                    background: "#000",
                    objectFit: "contain",
                  }}
                  onError={() => setVideoFrameError(true)}
                />
              ) : (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 18,
                    color: "#475569",
                    lineHeight: 1.6,
                  }}
                >
                  <p>Không tải được video qua proxy backend.</p>
                  <a
                    href={data.video_url || url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#2563eb", fontWeight: 600 }}
                  >
                    Mở video trên TikTok
                  </a>
                </div>
              )}

              <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                Video được phục vụ qua backend proxy để bypass lỗi 403 từ
                TikTok CDN. Lần phát đầu có thể chậm do server đang tải video.
              </p>
            </div>

            {/* COMMENTS SCROLL FIX */}
            <div
              className="card"
              style={{
                flex: 1,
                height: 600,          // 👈 FIX cứng bằng video
                overflowY: "auto",    // 👈 SCROLL DỌC
              }}
            >
              <h3>Comments</h3>

              {data.comments?.map((c: any, i: number) => {
                const labels: string[] =
                  Array.isArray(c.all_labels) && c.all_labels.length > 0
                    ? c.all_labels
                    : c.label
                      ? [c.label]
                      : [];

                const labelColor = (lb: string) => {
                  switch (lb) {
                    case "ENJOYMENT":
                      return "#4CAF50";
                    case "SURPRISE":
                      return "#19D3F3";
                    case "OTHER":
                      return "#FFC107";
                    case "ANGER":
                      return "#FF4B4B";
                    case "DISGUST":
                      return "#AB63FA";
                    case "SADNESS":
                      return "#636EFA";
                    case "FEAR":
                      return "#FFA15A";
                    default:
                      return "#9E9E9E";
                  }
                };

                return (
                  <div
                    key={i}
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <span style={{ flex: 1 }}>{c.text}</span>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        justifyContent: "flex-end",
                        maxWidth: 220,
                      }}
                      title={
                        c.probabilities
                          ? Object.entries(c.probabilities)
                              .map(([k, v]) => `${k}: ${Number(v).toFixed(3)}`)
                              .join("\n")
                          : undefined
                      }
                    >
                      {labels.map((lb, idx) => (
                        <span
                          key={`${lb}-${idx}`}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            fontSize: 12,
                            color: "white",
                            background: labelColor(lb),
                            fontWeight: idx === 0 ? 600 : 400,
                            opacity: idx === 0 ? 1 : 0.85,
                          }}
                        >
                          {lb}
                          {c.probabilities && c.probabilities[lb] !== undefined
                            ? ` ${Math.round(c.probabilities[lb] * 100)}%`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* INSIGHT */}
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h3>Nhận định AI</h3>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" onClick={downloadCSV}>
                  Download CSV
                </button>
                <button className="btn" onClick={downloadJSON}>
                  Download JSON
                </button>
              </div>
            </div>

            <p
              style={{
                whiteSpace: "pre-line",
                lineHeight: 1.8,
                color: "#1f2937",
                fontSize: 15,
              }}
            >
              {data.insight}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
