import fs from "node:fs/promises";

const exampleUrl = new URL("../examples/risky-change.json", import.meta.url);

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = JSON.parse(await fs.readFile(exampleUrl, "utf8"));
  return res.status(200).json(body);
}

