export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Content-Type": "application/json;charset=utf-8",
};

export function handleOptionsCors() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}