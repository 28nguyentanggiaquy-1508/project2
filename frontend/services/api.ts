const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export async function analyzeVideo(url: string, modelId?: string) {
  const res = await fetch(`${API_BASE_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, model_id: modelId }),
  });

  return res.json();
}

export async function getModels() {
  const res = await fetch(`${API_BASE_URL}/models`);
  return res.json();
}
