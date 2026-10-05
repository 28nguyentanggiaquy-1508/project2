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
  LineChart,
  Line,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function Home() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [videoFrameError, setVideoFrameError] = useState(false);

  // History
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyDetailLoadingId, setHistoryDetailLoadingId] = useState<number | null>(null);

  // Compare
  const [compareSelection, setCompareSelection] = useState<number[]>([]);
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");

  // Trend
  const [trendData, setTrendData] = useState<any>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");

  // Gemini Context Stabilization
  const [refreshingContext, setRefreshingContext] = useState(false);

  const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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

  const isHistoryDetail = Boolean(
    data?.analysis_id &&
    data?.created_at &&
    data?.model_versions
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

  const handleRefreshContext = async () => {
    if (!url) return;

    const accepted = window.confirm(
      "Làm mới Gemini Context sẽ gọi Gemini Vision lại và tạo một phiên phân tích mới. Tiếp tục?"
    );

    if (!accepted) return;

    setRefreshingContext(true);
    setLoading(true);
    setData(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            model_id: selectedModelId || null,
            refresh_context: true,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.detail ||
          `HTTP ${response.status}`
        );
      }

      setData(result);
    } catch (error) {
      console.error(error);

      setData({
        error:
          "Không thể refresh Gemini Context.",
      });
    } finally {
      setRefreshingContext(false);
      setLoading(false);
    }
  };

  // ============================================================
  // HISTORY
  // ============================================================

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/history?limit=30&offset=0`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      setHistoryItems(
        Array.isArray(result.items)
          ? result.items
          : []
      );
    } catch (error) {
      console.error(error);
      setHistoryError("Không tải được lịch sử phân tích.");
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    await loadHistory();
  };

  const openHistoryDetail = async (analysisId: number) => {
    setHistoryDetailLoadingId(analysisId);
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/history/${analysisId}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      setData(result);
      setUrl(result.video_url || "");

      if (
        result.model_id &&
        models.some((model) => model.id === result.model_id)
      ) {
        setSelectedModelId(result.model_id);
      }

      setHistoryOpen(false);

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error) {
      console.error(error);
      setHistoryError("Không tải được chi tiết phiên phân tích.");
    } finally {
      setHistoryDetailLoadingId(null);
    }
  };

  const removeHistoryItem = async (
    analysisId: number,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();

    const accepted = window.confirm(
      `Xóa phiên phân tích #${analysisId}?`
    );

    if (!accepted) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/history/${analysisId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setHistoryItems((current) =>
        current.filter(
          (item) => item.analysis_id !== analysisId
        )
      );

      setCompareSelection((current) =>
        current.filter(
          (id) => id !== analysisId
        )
      );

      if (
        compareData?.analysis_a?.analysis_id === analysisId ||
        compareData?.analysis_b?.analysis_id === analysisId
      ) {
        setCompareData(null);
      }

      if (data?.analysis_id === analysisId) {
        setData(null);
      }
    } catch (error) {
      console.error(error);
      setHistoryError("Không xóa được phiên phân tích.");
    }
  };

  const toggleCompareSelection = (analysisId: number) => {
    setHistoryError("");

    setCompareSelection((current) => {
      if (current.includes(analysisId)) {
        return current.filter(
          (id) => id !== analysisId
        );
      }

      if (current.length >= 2) {
        setHistoryError(
          "Compare V1 chỉ chọn tối đa 2 phiên."
        );
        return current;
      }

      return [
        ...current,
        analysisId,
      ];
    });
  };

  const runCompare = async () => {
    if (compareSelection.length !== 2) {
      setHistoryError(
        "Hãy chọn đúng 2 phiên để so sánh."
      );
      return;
    }

    const [analysisIdA, analysisIdB] =
      compareSelection;

    setCompareLoading(true);
    setCompareError("");
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/compare?analysis_id_a=${analysisIdA}&analysis_id_b=${analysisIdB}`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.detail ||
          `HTTP ${response.status}`
        );
      }

      setCompareData(result);
      setHistoryOpen(false);

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error: any) {
      console.error(error);

      setHistoryError(
        error?.message ||
        "Không so sánh được 2 phiên."
      );
    } finally {
      setCompareLoading(false);
    }
  };

  const closeCompare = () => {
    setCompareData(null);
    setCompareError("");
    setCompareSelection([]);
  };

  const formatDelta = (value: number) => {
    const number = Number(
      value || 0
    );

    if (number > 0) {
      return `+${number}`;
    }

    return String(number);
  };

  const consistencyColor = (percent: number) => {
    const value = Number(
      percent || 0
    );

    if (value >= 95) {
      return "#16a34a";
    }

    if (value >= 80) {
      return "#d97706";
    }

    return "#dc2626";
  };

  const openTrend = async (videoId: string) => {
    if (!videoId) return;

    setTrendLoading(true);
    setTrendError("");
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/trend/${encodeURIComponent(videoId)}?limit=20`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.detail ||
          `HTTP ${response.status}`
        );
      }

      setTrendData(result);
      setHistoryOpen(false);

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error: any) {
      console.error(error);

      const message =
        error?.message ||
        "Không tải được Trend.";

      if (historyOpen) {
        setHistoryError(message);
      } else {
        setTrendError(message);
      }
    } finally {
      setTrendLoading(false);
    }
  };

  const closeTrend = () => {
    setTrendData(null);
    setTrendError("");
  };

  const trendPointLabel = (
    createdAt: string,
    analysisId: number
  ) => {
    if (!createdAt) {
      return `#${analysisId}`;
    }

    const date = new Date(createdAt);

    if (Number.isNaN(date.getTime())) {
      return `#${analysisId}`;
    }

    return `#${analysisId} ${date.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  const trendColor = (percent: number | null | undefined) => {
    if (percent === null || percent === undefined) {
      return "#64748b";
    }

    const value = Number(percent);

    if (value >= 95) return "#16a34a";
    if (value >= 80) return "#d97706";
    return "#dc2626";
  };

  const formatHistoryTime = (value: string) => {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString("vi-VN");
  };

  const leaveHistoryDetail = () => {
    setData(null);
    setUrl("");
    setVideoFrameError(false);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
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

  // ============================================================
  // ABSA DATA
  // ============================================================

  const absaSummary = data?.absa_summary || null;

  const absaSentimentData = absaSummary
    ? [
      {
        name: "Positive",
        value: absaSummary.sentiments?.POSITIVE || 0,
        key: "POSITIVE",
      },
      {
        name: "Neutral",
        value: absaSummary.sentiments?.NEUTRAL || 0,
        key: "NEUTRAL",
      },
      {
        name: "Negative",
        value: absaSummary.sentiments?.NEGATIVE || 0,
        key: "NEGATIVE",
      },
    ]
    : [];

  const topAspects = Array.isArray(absaSummary?.top_aspects)
    ? absaSummary.top_aspects
    : [];

  const aspectChartData = topAspects.slice(0, 8).map((item: any) => ({
    name: item.term,
    value: item.count,
  }));

  const absaSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "POSITIVE":
        return "#16a34a";
      case "NEGATIVE":
        return "#dc2626";
      case "NEUTRAL":
        return "#d97706";
      default:
        return "#64748b";
    }
  };

  const compareEmotionChartData = compareData
    ? [
      {
        name: "Positive",
        A: compareData.emotion_summary?.positive?.a || 0,
        B: compareData.emotion_summary?.positive?.b || 0,
      },
      {
        name: "Neutral",
        A: compareData.emotion_summary?.neutral?.a || 0,
        B: compareData.emotion_summary?.neutral?.b || 0,
      },
      {
        name: "Negative",
        A: compareData.emotion_summary?.negative?.a || 0,
        B: compareData.emotion_summary?.negative?.b || 0,
      },
    ]
    : [];

  const compareABSAChartData = compareData
    ? [
      {
        name: "Positive",
        A: compareData.absa?.sentiments?.POSITIVE?.a || 0,
        B: compareData.absa?.sentiments?.POSITIVE?.b || 0,
      },
      {
        name: "Neutral",
        A: compareData.absa?.sentiments?.NEUTRAL?.a || 0,
        B: compareData.absa?.sentiments?.NEUTRAL?.b || 0,
      },
      {
        name: "Negative",
        A: compareData.absa?.sentiments?.NEGATIVE?.a || 0,
        B: compareData.absa?.sentiments?.NEGATIVE?.b || 0,
      },
    ]
    : [];

  const trendEmotionData = Array.isArray(trendData?.points)
    ? trendData.points.map((point: any) => ({
      label: trendPointLabel(
        point.created_at,
        point.analysis_id
      ),
      analysis_id: point.analysis_id,
      Positive: point.emotion?.positive || 0,
      Neutral: point.emotion?.neutral || 0,
      Negative: point.emotion?.negative || 0,
    }))
    : [];

  const trendABSAData = Array.isArray(trendData?.points)
    ? trendData.points.map((point: any) => ({
      label: trendPointLabel(
        point.created_at,
        point.analysis_id
      ),
      analysis_id: point.analysis_id,
      Positive: point.absa?.positive || 0,
      Neutral: point.absa?.neutral || 0,
      Negative: point.absa?.negative || 0,
      "Tổng aspect": point.absa?.total_aspects || 0,
    }))
    : [];

  const trendConsistencyData = Array.isArray(trendData?.transitions)
    ? trendData.transitions.map((transition: any) => ({
      label: `#${transition.from_analysis_id}→#${transition.to_analysis_id}`,
      "Comment overlap": transition.comment_overlap_percent,
      "Emotion agreement": transition.emotion_agreement_percent,
      "ABSA agreement": transition.absa_agreement_percent,
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

    const headers = [
      "comment",
      "label",
      "all_labels",
      "confidence",
      "aspect_terms",
      "aspect_sentiments",
    ];

    const rows = data.comments.map((c: any) => {
      const aspects = Array.isArray(c.absa?.aspects)
        ? c.absa.aspects
        : [];

      return [
        `"${c.text.replace(/"/g, '""')}"`,
        c.label,
        `"${(c.all_labels || []).join("|")}"`,
        c.confidence ?? "",
        `"${aspects.map((a: any) => a.term).join("|").replace(/"/g, '""')}"`,
        `"${aspects
          .map((a: any) => `${a.term}:${a.sentiment}`)
          .join("|")
          .replace(/"/g, '""')}"`,
      ];
    });

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

          <button
            className="btn"
            onClick={handleAnalyze}
            disabled={loading}
          >
            {loading && !refreshingContext
              ? "Đang xử lý..."
              : "Analyze"}
          </button>

          <button
            className="btn"
            type="button"
            onClick={handleRefreshContext}
            disabled={
              loading ||
              refreshingContext ||
              !url
            }
            title="Gọi Gemini Vision lại và cập nhật Context Cache"
            style={{
              background: "#d97706",
              whiteSpace: "nowrap",
            }}
          >
            {refreshingContext
              ? "Đang refresh..."
              : "Refresh Context"}
          </button>

          <button
            className="btn"
            type="button"
            onClick={openHistory}
            style={{
              background: "#0f172a",
              whiteSpace: "nowrap",
            }}
          >
            Lịch sử
          </button>

          {data?.video_id && (
            <button
              className="btn"
              type="button"
              onClick={() =>
                openTrend(
                  String(data.video_id)
                )
              }
              disabled={trendLoading}
              style={{
                background: "#0f766e",
                whiteSpace: "nowrap",
              }}
            >
              {trendLoading
                ? "Đang tải Trend..."
                : "Trend video này"}
            </button>
          )}
        </div>

        {data?.history_saved && data?.analysis_id && (
          <div
            style={{
              marginTop: 10,
              color: "#64748b",
              fontSize: 12,
            }}
          >
            Đã lưu phiên phân tích #{data.analysis_id}

            {data?.context_cache?.status && (
              <>
                {" · "}
                Context:
                {" "}
                <b>{data.context_cache.status}</b>
              </>
            )}
          </div>
        )}
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

      {historyOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="model-modal"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(920px, calc(100vw - 32px))",
              maxWidth: 920,
              maxHeight: "82vh",
              overflowY: "auto",
            }}
          >
            <div className="modal-header">
              <div>
                <h3 style={{ marginBottom: 4 }}>
                  Lịch sử phân tích
                </h3>
                <div
                  style={{
                    color: "#64748b",
                    fontSize: 12,
                  }}
                >
                  Các lần phân tích gần nhất được lưu trong SQLite
                </div>
              </div>

              <button
                className="icon-btn"
                onClick={() => setHistoryOpen(false)}
                title="Đóng"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 12,
                }}
              >
                Chọn 2 phiên:
                {" "}
                <b>
                  {compareSelection.length}/2
                </b>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn"
                  type="button"
                  onClick={runCompare}
                  disabled={
                    compareSelection.length !== 2 ||
                    compareLoading
                  }
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                    background:
                      compareSelection.length === 2
                        ? "#7c3aed"
                        : "#94a3b8",
                  }}
                >
                  {compareLoading
                    ? "Đang so sánh..."
                    : "So sánh 2 phiên"}
                </button>

                <button
                  className="btn"
                  type="button"
                  onClick={loadHistory}
                  disabled={historyLoading}
                  style={{
                    padding: "8px 12px",
                    fontSize: 12,
                  }}
                >
                  {historyLoading ? "Đang tải..." : "Làm mới"}
                </button>
              </div>
            </div>

            {historyError && (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#991b1b",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {historyError}
              </div>
            )}

            {historyLoading && historyItems.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                Đang tải lịch sử...
              </div>
            ) : historyItems.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                Chưa có phiên phân tích nào được lưu.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {historyItems.map((item: any) => {
                  const summary = item.summary || {};
                  const absa = item.absa_summary || {};
                  const sentiments = absa.sentiments || {};

                  return (
                    <div
                      key={item.analysis_id}
                      style={{
                        border:
                          compareSelection.includes(item.analysis_id)
                            ? "2px solid #8b5cf6"
                            : data?.analysis_id === item.analysis_id && isHistoryDetail
                              ? "2px solid #60a5fa"
                              : "1px solid #e2e8f0",
                        borderRadius: 12,
                        padding: 14,
                        background:
                          compareSelection.includes(item.analysis_id)
                            ? "#f5f3ff"
                            : data?.analysis_id === item.analysis_id && isHistoryDetail
                              ? "#eff6ff"
                              : "#ffffff",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 14,
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={compareSelection.includes(
                                item.analysis_id
                              )}
                              onChange={() =>
                                toggleCompareSelection(
                                  item.analysis_id
                                )
                              }
                              title="Chọn phiên để so sánh"
                            />

                            <b>#{item.analysis_id}</b>

                            <span
                              style={{
                                color: "#64748b",
                                fontSize: 12,
                              }}
                            >
                              {formatHistoryTime(item.created_at)}
                            </span>
                          </div>

                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 13,
                            }}
                          >
                            Video ID: <b>{item.video_id}</b>
                          </div>

                          <div
                            title={item.video_url}
                            style={{
                              marginTop: 4,
                              color: "#64748b",
                              fontSize: 12,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.video_url}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                              marginTop: 10,
                              fontSize: 12,
                            }}
                          >
                            <span>
                              Comments: <b>{item.comment_count || 0}</b>
                            </span>

                            <span style={{ color: "#16a34a" }}>
                              Emotion +: <b>{summary.positive || 0}</b>
                            </span>

                            <span style={{ color: "#d97706" }}>
                              Emotion =: <b>{summary.neutral || 0}</b>
                            </span>

                            <span style={{ color: "#dc2626" }}>
                              Emotion -: <b>{summary.negative || 0}</b>
                            </span>

                            <span>
                              Aspects: <b>{absa.total_aspects || 0}</b>
                            </span>

                            <span style={{ color: "#16a34a" }}>
                              ABSA +: <b>{sentiments.POSITIVE || 0}</b>
                            </span>

                            <span style={{ color: "#d97706" }}>
                              ABSA =: <b>{sentiments.NEUTRAL || 0}</b>
                            </span>

                            <span style={{ color: "#dc2626" }}>
                              ABSA -: <b>{sentiments.NEGATIVE || 0}</b>
                            </span>
                          </div>

                          <div
                            style={{
                              marginTop: 8,
                              color: "#64748b",
                              fontSize: 11,
                            }}
                          >
                            {item.model_id || "Không rõ model"}
                            {" · "}
                            {item.ate_model_version || "ATE ?"}
                            {" · "}
                            {item.asc_model_version || "ASC ?"}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
                            flexShrink: 0,
                          }}
                        >
                          <button
                            className="btn"
                            type="button"
                            disabled={
                              historyDetailLoadingId === item.analysis_id
                            }
                            onClick={() =>
                              openHistoryDetail(item.analysis_id)
                            }
                            style={{
                              padding: "8px 12px",
                              fontSize: 12,
                            }}
                          >
                            {historyDetailLoadingId === item.analysis_id
                              ? "Đang mở..."
                              : "Xem chi tiết"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              openTrend(
                                String(item.video_id)
                              )
                            }
                            disabled={trendLoading}
                            style={{
                              border: "1px solid #99f6e4",
                              background: "#f0fdfa",
                              color: "#0f766e",
                              borderRadius: 8,
                              padding: "7px 10px",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            Trend
                          </button>

                          <button
                            type="button"
                            onClick={(event) =>
                              removeHistoryItem(
                                item.analysis_id,
                                event
                              )
                            }
                            style={{
                              border: "1px solid #fecaca",
                              background: "#fff",
                              color: "#dc2626",
                              borderRadius: 8,
                              padding: "7px 10px",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {trendData && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            border: "1px solid #99f6e4",
            background: "#f0fdfa",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: 5,
                }}
              >
                Trend V1
              </h3>

              <div
                style={{
                  color: "#475569",
                  fontSize: 13,
                }}
              >
                Video ID:
                {" "}
                <b>{trendData.video_id}</b>
                {" · "}
                {trendData.session_count || 0}
                {" "}
                phiên đã lưu
              </div>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                Trend đọc từ SQLite History, không crawl và không chạy model lại.
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                type="button"
                onClick={openHistory}
                style={{
                  background: "#0f766e",
                }}
              >
                Mở lịch sử
              </button>

              <button
                className="btn"
                type="button"
                onClick={closeTrend}
                style={{
                  background: "#0f172a",
                }}
              >
                Đóng Trend
              </button>
            </div>
          </div>

          {trendError && (
            <div
              style={{
                marginTop: 12,
                color: "#991b1b",
              }}
            >
              {trendError}
            </div>
          )}

          {/* MODEL CONSISTENCY */}
          <div
            style={{
              marginTop: 16,
              padding: 11,
              borderRadius: 10,
              border: "1px solid #ccfbf1",
              background: "#ffffff",
              color: "#475569",
              fontSize: 11,
            }}
          >
            <b>Model consistency:</b>
            {" "}
            Emotion
            {" "}
            <b
              style={{
                color:
                  trendData.model_consistency?.same_emotion_model
                    ? "#16a34a"
                    : "#dc2626",
              }}
            >
              {trendData.model_consistency?.same_emotion_model
                ? "ổn định"
                : "đã đổi model"}
            </b>
            {" · "}
            ATE
            {" "}
            <b
              style={{
                color:
                  trendData.model_consistency?.same_ate_model
                    ? "#16a34a"
                    : "#dc2626",
              }}
            >
              {trendData.model_consistency?.same_ate_model
                ? "ổn định"
                : "đã đổi"}
            </b>
            {" · "}
            ASC
            {" "}
            <b
              style={{
                color:
                  trendData.model_consistency?.same_asc_model
                    ? "#16a34a"
                    : "#dc2626",
              }}
            >
              {trendData.model_consistency?.same_asc_model
                ? "ổn định"
                : "đã đổi"}
            </b>
          </div>

          {/* STABILITY CARDS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
              marginTop: 14,
            }}
          >
            {[
              {
                label: "Số phiên",
                value: trendData.session_count || 0,
                color: "#0f766e",
                note: `${trendData.transition_count || 0} khoảng chuyển`,
              },
              {
                label: "Avg comment overlap",
                value:
                  trendData.stability_summary?.avg_comment_overlap_percent !== null &&
                  trendData.stability_summary?.avg_comment_overlap_percent !== undefined
                    ? `${trendData.stability_summary.avg_comment_overlap_percent}%`
                    : "—",
                color:
                  trendColor(
                    trendData.stability_summary?.avg_comment_overlap_percent
                  ),
                note: "Mức trùng dữ liệu giữa các phiên liên tiếp",
              },
              {
                label: "Avg emotion agreement",
                value:
                  trendData.stability_summary?.avg_emotion_agreement_percent !== null &&
                  trendData.stability_summary?.avg_emotion_agreement_percent !== undefined
                    ? `${trendData.stability_summary.avg_emotion_agreement_percent}%`
                    : "—",
                color:
                  trendColor(
                    trendData.stability_summary?.avg_emotion_agreement_percent
                  ),
                note: "Độ ổn định nhãn emotion",
              },
              {
                label: "Avg ABSA agreement",
                value:
                  trendData.stability_summary?.avg_absa_agreement_percent !== null &&
                  trendData.stability_summary?.avg_absa_agreement_percent !== undefined
                    ? `${trendData.stability_summary.avg_absa_agreement_percent}%`
                    : "—",
                color:
                  trendColor(
                    trendData.stability_summary?.avg_absa_agreement_percent
                  ),
                note: "Độ ổn định aspect + sentiment",
              },
              {
                label: "Context thay đổi",
                value:
                  `${trendData.stability_summary?.context_changed_count || 0}/${trendData.transition_count || 0}`,
                color:
                  (trendData.stability_summary?.context_changed_count || 0) > 0
                    ? "#d97706"
                    : "#16a34a",
                note: "Số transition Gemini context thay đổi",
              },
            ].map((item: any) => (
              <div
                key={item.label}
                style={{
                  background: "#ffffff",
                  border: "1px solid #ccfbf1",
                  borderRadius: 10,
                  padding: 11,
                }}
              >
                <div
                  style={{
                    color: "#64748b",
                    fontSize: 11,
                  }}
                >
                  {item.label}
                </div>

                <div
                  style={{
                    marginTop: 4,
                    fontSize: 22,
                    fontWeight: 700,
                    color: item.color,
                  }}
                >
                  {item.value}
                </div>

                <div
                  style={{
                    marginTop: 3,
                    color: "#94a3b8",
                    fontSize: 10,
                  }}
                >
                  {item.note}
                </div>
              </div>
            ))}
          </div>

          {trendData.session_count < 2 ? (
            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 10,
                background: "#ffffff",
                color: "#64748b",
                fontSize: 13,
              }}
            >
              Cần ít nhất 2 phiên của cùng video để vẽ Trend.
            </div>
          ) : (
            <>
              {/* EMOTION TREND */}
              <div
                style={{
                  marginTop: 24,
                  background: "#ffffff",
                  borderRadius: 12,
                  padding: 14,
                  border: "1px solid #ccfbf1",
                }}
              >
                <h4
                  style={{
                    marginTop: 0,
                  }}
                >
                  Emotion trend
                </h4>

                <div
                  style={{
                    width: "100%",
                    height: 300,
                  }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={trendEmotionData}
                      margin={{
                        top: 10,
                        right: 20,
                        left: 0,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="Positive"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Neutral"
                        stroke="#d97706"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Negative"
                        stroke="#dc2626"
                        strokeWidth={2}
                        dot
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ABSA TREND */}
              <div
                style={{
                  marginTop: 18,
                  background: "#ffffff",
                  borderRadius: 12,
                  padding: 14,
                  border: "1px solid #ccfbf1",
                }}
              >
                <h4
                  style={{
                    marginTop: 0,
                  }}
                >
                  ABSA trend
                </h4>

                <div
                  style={{
                    width: "100%",
                    height: 300,
                  }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={trendABSAData}
                      margin={{
                        top: 10,
                        right: 20,
                        left: 0,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="Positive"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Neutral"
                        stroke="#d97706"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Negative"
                        stroke="#dc2626"
                        strokeWidth={2}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="Tổng aspect"
                        stroke="#2563eb"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* CONSISTENCY TREND */}
              <div
                style={{
                  marginTop: 18,
                  background: "#ffffff",
                  borderRadius: 12,
                  padding: 14,
                  border: "1px solid #ccfbf1",
                }}
              >
                <h4
                  style={{
                    marginTop: 0,
                    marginBottom: 4,
                  }}
                >
                  Consistency giữa các phiên liên tiếp
                </h4>

                <div
                  style={{
                    color: "#64748b",
                    fontSize: 11,
                    marginBottom: 10,
                  }}
                >
                  Các đường là phần trăm. 100% nghĩa là hai phiên liên tiếp giống nhau hoàn toàn theo metric đó.
                </div>

                <div
                  style={{
                    width: "100%",
                    height: 300,
                  }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <LineChart
                      data={trendConsistencyData}
                      margin={{
                        top: 10,
                        right: 20,
                        left: 0,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip
                        formatter={(value: any) =>
                          value === null || value === undefined
                            ? "—"
                            : `${value}%`
                        }
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="Comment overlap"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="Emotion agreement"
                        stroke="#d97706"
                        strokeWidth={2}
                        dot
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="ABSA agreement"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* TRANSITION TABLE */}
              <div
                style={{
                  marginTop: 18,
                }}
              >
                <h4>
                  Chi tiết các transition
                </h4>

                <div
                  style={{
                    overflowX: "auto",
                    border: "1px solid #ccfbf1",
                    borderRadius: 10,
                    background: "#fff",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: "left",
                          background: "#f0fdfa",
                        }}
                      >
                        <th style={{ padding: 9 }}>
                          Transition
                        </th>
                        <th style={{ padding: 9 }}>
                          Comment overlap
                        </th>
                        <th style={{ padding: 9 }}>
                          Emotion agreement
                        </th>
                        <th style={{ padding: 9 }}>
                          ABSA agreement
                        </th>
                        <th style={{ padding: 9 }}>
                          Context
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {(trendData.transitions || []).map(
                        (transition: any) => (
                          <tr
                            key={`${transition.from_analysis_id}-${transition.to_analysis_id}`}
                            style={{
                              borderTop: "1px solid #e2e8f0",
                            }}
                          >
                            <td
                              style={{
                                padding: 9,
                                fontWeight: 700,
                              }}
                            >
                              #{transition.from_analysis_id}
                              {" → "}
                              #{transition.to_analysis_id}
                            </td>

                            <td
                              style={{
                                padding: 9,
                                color: trendColor(
                                  transition.comment_overlap_percent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {transition.comment_overlap_percent ?? "—"}%
                            </td>

                            <td
                              style={{
                                padding: 9,
                                color: trendColor(
                                  transition.emotion_agreement_percent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {transition.emotion_agreement_percent ?? "—"}%
                            </td>

                            <td
                              style={{
                                padding: 9,
                                color: trendColor(
                                  transition.absa_agreement_percent
                                ),
                                fontWeight: 600,
                              }}
                            >
                              {transition.absa_agreement_percent ?? "—"}%
                            </td>

                            <td
                              style={{
                                padding: 9,
                                color: transition.context_changed
                                  ? "#d97706"
                                  : "#16a34a",
                                fontWeight: 600,
                              }}
                            >
                              {transition.context_changed
                                ? `Thay đổi${
                                    Array.isArray(
                                      transition.context_changed_fields
                                    ) &&
                                    transition.context_changed_fields.length
                                      ? ` (${transition.context_changed_fields.join(", ")})`
                                      : ""
                                  }`
                                : "Ổn định"}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div
            style={{
              marginTop: 14,
              color: "#64748b",
              fontSize: 10,
            }}
          >
            Lưu ý: đường Trend mô tả kết quả các lần phân tích đã lưu.
            Khi Comment overlap thấp, model thay đổi, hoặc Gemini context thay đổi,
            không nên diễn giải mọi biến động như phản ứng người xem thay đổi thật.
          </div>
        </div>
      )}

      {compareData && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            border: "1px solid #ddd6fe",
            background: "#faf5ff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 5 }}>
                Compare V1.1
              </h3>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                So sánh phiên
                {" "}
                <b>#{compareData.analysis_a?.analysis_id}</b>
                {" "}
                và
                {" "}
                <b>#{compareData.analysis_b?.analysis_id}</b>
              </div>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 12,
                  marginTop: 3,
                }}
              >
                {compareData.same_video
                  ? "Cùng một video - phù hợp để xem thay đổi giữa các lần phân tích."
                  : "Hai video khác nhau - đang so sánh kết quả tổng hợp."}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                type="button"
                onClick={openHistory}
                style={{
                  background: "#7c3aed",
                }}
              >
                Đổi lựa chọn
              </button>

              <button
                className="btn"
                type="button"
                onClick={closeCompare}
                style={{
                  background: "#0f172a",
                }}
              >
                Đóng so sánh
              </button>
            </div>
          </div>

          {compareError && (
            <div
              style={{
                marginTop: 12,
                color: "#991b1b",
              }}
            >
              {compareError}
            </div>
          )}

          {/* SESSION CARDS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12,
              marginTop: 18,
            }}
          >
            {[
              {
                label: "Phiên A",
                item: compareData.analysis_a,
                color: "#2563eb",
                bg: "#eff6ff",
              },
              {
                label: "Phiên B",
                item: compareData.analysis_b,
                color: "#7c3aed",
                bg: "#f5f3ff",
              },
            ].map((session: any) => (
              <div
                key={session.label}
                style={{
                  border: `1px solid ${session.color}33`,
                  background: session.bg,
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    color: session.color,
                    fontWeight: 700,
                  }}
                >
                  {session.label}
                  {" "}
                  #{session.item?.analysis_id}
                </div>

                <div
                  style={{
                    marginTop: 7,
                    fontSize: 13,
                  }}
                >
                  Video ID:
                  {" "}
                  <b>{session.item?.video_id}</b>
                </div>

                <div
                  style={{
                    marginTop: 4,
                    color: "#64748b",
                    fontSize: 12,
                  }}
                >
                  {formatHistoryTime(
                    session.item?.created_at
                  )}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                  }}
                >
                  Comments:
                  {" "}
                  <b>{session.item?.comment_count || 0}</b>
                  {" · "}
                  Aspects:
                  {" "}
                  <b>
                    {session.item?.absa_summary?.total_aspects || 0}
                  </b>
                </div>

                <div
                  style={{
                    marginTop: 5,
                    color: "#64748b",
                    fontSize: 11,
                  }}
                >
                  {session.item?.model_id || "Không rõ emotion model"}
                </div>
              </div>
            ))}
          </div>

          {/* DATA CONSISTENCY - Compare V1.1 */}
          {compareData.consistency && (
            <div
              style={{
                marginTop: 22,
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <h4
                    style={{
                      marginTop: 0,
                      marginBottom: 4,
                    }}
                  >
                    Data Consistency
                  </h4>

                  <div
                    style={{
                      color: "#64748b",
                      fontSize: 12,
                    }}
                  >
                    Kiểm tra 2 phiên có dùng cùng tập comment và cho kết quả ổn định hay không.
                  </div>
                </div>

                <div
                  style={{
                    color: compareData.consistency.video_context?.same
                      ? "#16a34a"
                      : "#d97706",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  Video context:
                  {" "}
                  {compareData.consistency.video_context?.same
                    ? "GIỐNG NHAU"
                    : "CÓ THAY ĐỔI"}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                  marginTop: 16,
                }}
              >
                {[
                  {
                    label: "Comment overlap",
                    value:
                      `${compareData.consistency.comments?.overlap_percent || 0}%`,
                    color:
                      consistencyColor(
                        compareData.consistency.comments?.overlap_percent || 0
                      ),
                    note:
                      `${compareData.consistency.comments?.common || 0} chung / ${compareData.consistency.comments?.union || 0} unique`,
                  },
                  {
                    label: "Chỉ có ở A",
                    value:
                      compareData.consistency.comments?.only_a || 0,
                    color: "#2563eb",
                    note:
                      `A có ${compareData.consistency.comments?.count_a || 0} comments`,
                  },
                  {
                    label: "Chỉ có ở B",
                    value:
                      compareData.consistency.comments?.only_b || 0,
                    color: "#7c3aed",
                    note:
                      `B có ${compareData.consistency.comments?.count_b || 0} comments`,
                  },
                  {
                    label: "Emotion agreement",
                    value:
                      `${compareData.consistency.emotion?.agreement_percent || 0}%`,
                    color:
                      consistencyColor(
                        compareData.consistency.emotion?.agreement_percent || 0
                      ),
                    note:
                      `${compareData.consistency.emotion?.same_label || 0} giống · ${compareData.consistency.emotion?.changed_label || 0} đổi nhãn`,
                  },
                  {
                    label: "ABSA agreement",
                    value:
                      `${compareData.consistency.absa?.relevant_agreement_percent || 0}%`,
                    color:
                      consistencyColor(
                        compareData.consistency.absa?.relevant_agreement_percent || 0
                      ),
                    note:
                      `${compareData.consistency.absa?.exact_relevant || 0}/${compareData.consistency.absa?.relevant_common || 0} comment có aspect`,
                  },
                  {
                    label: "ABSA pair overlap",
                    value:
                      `${compareData.consistency.absa?.pair_overlap_percent || 0}%`,
                    color:
                      consistencyColor(
                        compareData.consistency.absa?.pair_overlap_percent || 0
                      ),
                    note:
                      `${compareData.consistency.absa?.pair_common || 0} pair chung`,
                  },
                ].map((item: any) => (
                  <div
                    key={item.label}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: 11,
                      background: "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        color: "#64748b",
                        fontSize: 11,
                      }}
                    >
                      {item.label}
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 22,
                        fontWeight: 700,
                        color: item.color,
                      }}
                    >
                      {item.value}
                    </div>

                    <div
                      style={{
                        marginTop: 3,
                        color: "#94a3b8",
                        fontSize: 10,
                      }}
                    >
                      {item.note}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 14,
                  marginTop: 16,
                }}
              >
                {/* Emotion transitions */}
                <div>
                  <h5
                    style={{
                      marginTop: 0,
                      marginBottom: 8,
                    }}
                  >
                    Emotion thay đổi trên comment chung
                  </h5>

                  {Array.isArray(
                    compareData.consistency.emotion?.transitions
                  ) &&
                  compareData.consistency.emotion.transitions.length > 0 ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {compareData.consistency.emotion.transitions.map(
                        (transition: any) => (
                          <span
                            key={`${transition.from}-${transition.to}`}
                            style={{
                              border: "1px solid #fed7aa",
                              background: "#fff7ed",
                              color: "#9a3412",
                              borderRadius: 999,
                              padding: "4px 8px",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {transition.from}
                            {" → "}
                            {transition.to}
                            {" : "}
                            {transition.count}
                          </span>
                        )
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        color: "#16a34a",
                        fontSize: 12,
                      }}
                    >
                      Không có comment chung nào đổi emotion label.
                    </div>
                  )}
                </div>

                {/* Context differences */}
                <div>
                  <h5
                    style={{
                      marginTop: 0,
                      marginBottom: 8,
                    }}
                  >
                    Gemini video context
                  </h5>

                  {compareData.consistency.video_context?.same ? (
                    <div
                      style={{
                        color: "#16a34a",
                        fontSize: 12,
                      }}
                    >
                      Context được lưu ở 2 phiên là giống nhau.
                    </div>
                  ) : (
                    <div
                      style={{
                        color: "#d97706",
                        fontSize: 12,
                      }}
                    >
                      Trường thay đổi:
                      {" "}
                      <b>
                        {(compareData.consistency.video_context?.changed_fields || []).join(", ")}
                      </b>

                      <div
                        style={{
                          marginTop: 5,
                          color: "#64748b",
                        }}
                      >
                        Tone A:
                        {" "}
                        {compareData.consistency.video_context?.tone_a || "—"}
                        {" · "}
                        Tone B:
                        {" "}
                        {compareData.consistency.video_context?.tone_b || "—"}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Changed emotion examples */}
              {Array.isArray(
                compareData.consistency.emotion?.changed_examples
              ) &&
              compareData.consistency.emotion.changed_examples.length > 0 && (
                <div
                  style={{
                    marginTop: 18,
                  }}
                >
                  <h5
                    style={{
                      marginBottom: 8,
                    }}
                  >
                    Ví dụ comment đổi emotion label
                  </h5>

                  <div
                    style={{
                      overflowX: "auto",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 11,
                        background: "#fff",
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            background: "#f8fafc",
                            textAlign: "left",
                          }}
                        >
                          <th style={{ padding: 9 }}>
                            Comment
                          </th>
                          <th style={{ padding: 9 }}>
                            A
                          </th>
                          <th style={{ padding: 9 }}>
                            B
                          </th>
                          <th style={{ padding: 9 }}>
                            Conf. A
                          </th>
                          <th style={{ padding: 9 }}>
                            Conf. B
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {compareData.consistency.emotion.changed_examples.map(
                          (example: any, index: number) => (
                            <tr
                              key={`${example.comment_id || "text"}-${index}`}
                              style={{
                                borderTop: "1px solid #e2e8f0",
                              }}
                            >
                              <td
                                style={{
                                  padding: 9,
                                  maxWidth: 420,
                                }}
                              >
                                {example.text}
                              </td>

                              <td
                                style={{
                                  padding: 9,
                                  color: "#2563eb",
                                  fontWeight: 600,
                                }}
                              >
                                {example.label_a}
                              </td>

                              <td
                                style={{
                                  padding: 9,
                                  color: "#7c3aed",
                                  fontWeight: 600,
                                }}
                              >
                                {example.label_b}
                              </td>

                              <td style={{ padding: 9 }}>
                                {example.confidence_a !== null &&
                                example.confidence_a !== undefined
                                  ? `${Math.round(
                                      Number(example.confidence_a) * 100
                                    )}%`
                                  : "—"}
                              </td>

                              <td style={{ padding: 9 }}>
                                {example.confidence_b !== null &&
                                example.confidence_b !== undefined
                                  ? `${Math.round(
                                      Number(example.confidence_b) * 100
                                    )}%`
                                  : "—"}
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div
                style={{
                  marginTop: 14,
                  color: "#64748b",
                  fontSize: 10,
                }}
              >
                Lưu ý: Consistency chỉ đo mức ổn định giữa 2 lần chạy,
                không phải Accuracy/F1 so với ground truth.
              </div>
            </div>
          )}

          {/* COMPARE CHARTS */}
          <div
            style={{
              display: "flex",
              gap: 20,
              flexWrap: "wrap",
              marginTop: 22,
            }}
          >
            <div
              style={{
                flex: "1 1 430px",
                minWidth: 0,
              }}
            >
              <h4>Emotion summary</h4>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              >
                A = #{compareData.analysis_a?.analysis_id}
                {" · "}
                B = #{compareData.analysis_b?.analysis_id}
              </div>

              <BarChart
                width={440}
                height={250}
                data={compareEmotionChartData}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="A"
                  fill="#2563eb"
                />
                <Bar
                  dataKey="B"
                  fill="#7c3aed"
                />
              </BarChart>
            </div>

            <div
              style={{
                flex: "1 1 430px",
                minWidth: 0,
              }}
            >
              <h4>ABSA sentiment</h4>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 11,
                  marginBottom: 4,
                }}
              >
                A = #{compareData.analysis_a?.analysis_id}
                {" · "}
                B = #{compareData.analysis_b?.analysis_id}
              </div>

              <BarChart
                width={440}
                height={250}
                data={compareABSAChartData}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="A"
                  fill="#2563eb"
                />
                <Bar
                  dataKey="B"
                  fill="#7c3aed"
                />
              </BarChart>
            </div>
          </div>

          {/* SUMMARY DELTAS */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginTop: 14,
            }}
          >
            {[
              {
                label: "Emotion Positive Δ",
                value:
                  compareData.emotion_summary?.positive?.delta || 0,
              },
              {
                label: "Emotion Neutral Δ",
                value:
                  compareData.emotion_summary?.neutral?.delta || 0,
              },
              {
                label: "Emotion Negative Δ",
                value:
                  compareData.emotion_summary?.negative?.delta || 0,
              },
              {
                label: "Tổng aspect Δ",
                value:
                  compareData.absa?.total_aspects?.delta || 0,
              },
              {
                label: "ABSA Positive Δ",
                value:
                  compareData.absa?.sentiments?.POSITIVE?.delta || 0,
              },
              {
                label: "ABSA Neutral Δ",
                value:
                  compareData.absa?.sentiments?.NEUTRAL?.delta || 0,
              },
              {
                label: "ABSA Negative Δ",
                value:
                  compareData.absa?.sentiments?.NEGATIVE?.delta || 0,
              },
            ].map((item: any) => (
              <div
                key={item.label}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    color: "#64748b",
                    fontSize: 11,
                  }}
                >
                  {item.label}
                </div>

                <div
                  style={{
                    marginTop: 4,
                    fontSize: 20,
                    fontWeight: 700,
                    color:
                      Number(item.value) > 0
                        ? "#16a34a"
                        : Number(item.value) < 0
                          ? "#dc2626"
                          : "#475569",
                  }}
                >
                  {formatDelta(item.value)}
                </div>
              </div>
            ))}
          </div>

          {/* TOP ASPECT COMPARISON */}
          <div style={{ marginTop: 22 }}>
            <h4>
              Top Aspects - A/B
            </h4>

            {Array.isArray(
              compareData.absa?.top_aspects
            ) &&
            compareData.absa.top_aspects.length > 0 ? (
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  background: "#fff",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "#f8fafc",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: 10 }}>
                        Aspect
                      </th>
                      <th style={{ padding: 10 }}>
                        A
                      </th>
                      <th style={{ padding: 10 }}>
                        B
                      </th>
                      <th style={{ padding: 10 }}>
                        Δ B-A
                      </th>
                      <th style={{ padding: 10 }}>
                        Sentiment A
                      </th>
                      <th style={{ padding: 10 }}>
                        Sentiment B
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {compareData.absa.top_aspects.map(
                      (aspect: any) => (
                        <tr
                          key={aspect.term}
                          style={{
                            borderTop: "1px solid #e2e8f0",
                          }}
                        >
                          <td
                            style={{
                              padding: 10,
                              fontWeight: 600,
                            }}
                          >
                            {aspect.term}
                          </td>

                          <td style={{ padding: 10 }}>
                            {aspect.count_a}
                          </td>

                          <td style={{ padding: 10 }}>
                            {aspect.count_b}
                          </td>

                          <td
                            style={{
                              padding: 10,
                              fontWeight: 700,
                              color:
                                aspect.delta > 0
                                  ? "#16a34a"
                                  : aspect.delta < 0
                                    ? "#dc2626"
                                    : "#64748b",
                            }}
                          >
                            {formatDelta(aspect.delta)}
                          </td>

                          <td style={{ padding: 10 }}>
                            +{aspect.sentiments_a?.POSITIVE || 0}
                            {" / "}
                            ={aspect.sentiments_a?.NEUTRAL || 0}
                            {" / "}
                            -{aspect.sentiments_a?.NEGATIVE || 0}
                          </td>

                          <td style={{ padding: 10 }}>
                            +{aspect.sentiments_b?.POSITIVE || 0}
                            {" / "}
                            ={aspect.sentiments_b?.NEUTRAL || 0}
                            {" / "}
                            -{aspect.sentiments_b?.NEGATIVE || 0}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p
                style={{
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                Hai phiên chưa có aspect để so sánh.
              </p>
            )}
          </div>
        </div>
      )}

      {isHistoryDetail && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#1e3a8a",
                  marginBottom: 4,
                }}
              >
                Đang xem dữ liệu lịch sử
              </div>

              <div
                style={{
                  color: "#475569",
                  fontSize: 13,
                }}
              >
                Phiên #{data.analysis_id}
                {" · "}
                {formatHistoryTime(data.created_at)}
                {" · "}
                Video ID: {data.video_id}
              </div>

              <div
                style={{
                  color: "#64748b",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Dữ liệu được đọc từ database, không chạy lại crawler hay AI.
              </div>
            </div>

            <button
              className="btn"
              type="button"
              onClick={leaveHistoryDetail}
              style={{
                background: "#0f172a",
                whiteSpace: "nowrap",
              }}
            >
              ← Quay lại phân tích mới
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
            <h3>
              Tổng quan
              {isHistoryDetail && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#2563eb",
                    background: "#dbeafe",
                    borderRadius: 999,
                    padding: "3px 8px",
                    verticalAlign: "middle",
                  }}
                >
                  Phiên lịch sử #{data.analysis_id}
                </span>
              )}
            </h3>
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

              {data.context_cache && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                    marginTop: 8,
                    marginBottom: 10,
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      borderRadius: 999,
                      padding: "4px 8px",
                      fontWeight: 700,
                      background:
                        data.context_cache.status === "HIT"
                          ? "#dcfce7"
                          : data.context_cache.status === "REFRESHED"
                            ? "#ffedd5"
                            : "#e0f2fe",
                      color:
                        data.context_cache.status === "HIT"
                          ? "#166534"
                          : data.context_cache.status === "REFRESHED"
                            ? "#9a3412"
                            : "#075985",
                    }}
                  >
                    Context Cache:
                    {" "}
                    {data.context_cache.status}
                  </span>

                  <span
                    style={{
                      color: "#64748b",
                    }}
                  >
                    Fingerprint:
                    {" "}
                    <code>
                      {data.context_cache.fingerprint || "—"}
                    </code>
                  </span>

                  {data.context_cache.cached_at && (
                    <span
                      style={{
                        color: "#64748b",
                      }}
                    >
                      Cached:
                      {" "}
                      {formatHistoryTime(
                        data.context_cache.cached_at
                      )}
                    </span>
                  )}
                </div>
              )}
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

          {/* ABSA DASHBOARD */}
          {absaSummary && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 6 }}>
                ABSA - Phân tích khía cạnh
              </h3>

              <p
                style={{
                  marginTop: 0,
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                Aspect Term Extraction + Aspect Sentiment Classification
              </p>

              {/* ABSA SUMMARY CARDS */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 12,
                  marginTop: 16,
                  marginBottom: 22,
                }}
              >
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 12 }}>
                    Comments có aspect
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {absaSummary.comments_with_aspects || 0}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>
                    / {absaSummary.comments_analyzed || data.comments?.length || 0} comments
                  </div>
                </div>

                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 12 }}>
                    Tổng aspect
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {absaSummary.total_aspects || 0}
                  </div>
                </div>

                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#166534", fontSize: 12 }}>
                    Positive
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {absaSummary.sentiments?.POSITIVE || 0}
                  </div>
                </div>

                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#92400e", fontSize: 12 }}>
                    Neutral
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {absaSummary.sentiments?.NEUTRAL || 0}
                  </div>
                </div>

                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#991b1b", fontSize: 12 }}>
                    Negative
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                    {absaSummary.sentiments?.NEGATIVE || 0}
                  </div>
                </div>
              </div>

              {/* ABSA CHARTS */}
              <div
                style={{
                  display: "flex",
                  gap: 20,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    flex: "1 1 320px",
                    minWidth: 0,
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>
                    Aspect Sentiment
                  </h4>

                  {absaSummary.total_aspects > 0 ? (
                    <PieChart width={300} height={240}>
                      <Pie
                        data={absaSentimentData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={90}
                      >
                        {absaSentimentData.map((entry: any) => (
                          <Cell
                            key={entry.key}
                            fill={absaSentimentColor(entry.key)}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  ) : (
                    <p style={{ color: "#94a3b8", fontSize: 13 }}>
                      Chưa phát hiện aspect trong các comment đã phân tích.
                    </p>
                  )}
                </div>

                <div
                  style={{
                    flex: "1 1 420px",
                    minWidth: 0,
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>
                    Top Aspects
                  </h4>

                  {aspectChartData.length > 0 ? (
                    <BarChart
                      width={430}
                      height={240}
                      data={aspectChartData}
                      margin={{
                        top: 5,
                        right: 12,
                        left: 0,
                        bottom: 45,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="name"
                        interval={0}
                        angle={-25}
                        textAnchor="end"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#6366f1" />
                    </BarChart>
                  ) : (
                    <p style={{ color: "#94a3b8", fontSize: 13 }}>
                      Chưa có aspect để thống kê.
                    </p>
                  )}
                </div>
              </div>

              {/* TOP ASPECT DETAIL */}
              {topAspects.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <h4 style={{ marginBottom: 10 }}>
                    Chi tiết aspect nổi bật
                  </h4>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {topAspects.slice(0, 10).map((item: any) => (
                      <div
                        key={item.term}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 10,
                          padding: "8px 10px",
                          background: "#ffffff",
                          fontSize: 12,
                        }}
                      >
                        <b>{item.term}</b>
                        <span style={{ color: "#64748b" }}>
                          {" "}× {item.count}
                        </span>

                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            marginTop: 5,
                            flexWrap: "wrap",
                          }}
                        >
                          {(["POSITIVE", "NEUTRAL", "NEGATIVE"] as const).map(
                            (sentiment) => {
                              const count =
                                item.sentiments?.[sentiment] || 0;

                              if (!count) return null;

                              return (
                                <span
                                  key={sentiment}
                                  style={{
                                    color: absaSentimentColor(sentiment),
                                    fontWeight: 600,
                                  }}
                                >
                                  {sentiment}: {count}
                                </span>
                              );
                            }
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{c.text}</div>

                      {Array.isArray(c.absa?.aspects) &&
                        c.absa.aspects.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 8,
                            }}
                          >
                            {c.absa.aspects.map(
                              (aspect: any, aspectIndex: number) => (
                                <span
                                  key={`${aspect.term}-${aspectIndex}`}
                                  title={
                                    aspect.confidence !== undefined
                                      ? `ABSA confidence: ${Math.round(
                                          Number(aspect.confidence) * 100
                                        )}%`
                                      : undefined
                                  }
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "3px 7px",
                                    borderRadius: 999,
                                    border: `1px solid ${absaSentimentColor(
                                      aspect.sentiment
                                    )}`,
                                    color: absaSentimentColor(
                                      aspect.sentiment
                                    ),
                                    background: "#ffffff",
                                    fontSize: 11,
                                    fontWeight: 600,
                                  }}
                                >
                                  <span>{aspect.term}</span>
                                  <span>·</span>
                                  <span>{aspect.sentiment}</span>
                                </span>
                              )
                            )}
                          </div>
                        )}
                    </div>

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
