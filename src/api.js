export async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `请求失败（${response.status}）`);
  }
  return response.json();
}
export function writeJson(method, value) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}
