import {
  dispatchPublic,
  parseInput,
  errorResponse,
  SECURITY_HEADERS,
} from '../src/studio/public-api.mjs';
export default async function handler(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('allow', 'GET, POST');
    return res
      .status(405)
      .json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST' } });
  }
  if (req.method === 'POST') {
    if (
      !String(req.headers?.['content-type'] || '')
        .toLowerCase()
        .startsWith('application/json')
    )
      return res
        .status(415)
        .json({ error: { code: 'CONTENT_TYPE', message: 'Use application/json' } });
    if (req.headers?.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return res.status(403).json({
            error: { code: 'ORIGIN_DENIED', message: 'Cross-origin requests are not allowed' },
          });
      } catch {
        return res
          .status(403)
          .json({ error: { code: 'ORIGIN_DENIED', message: 'Invalid origin' } });
      }
    }
  }
  try {
    return res
      .status(200)
      .json(
        await dispatchPublic(req.method, req.method === 'POST' ? parseInput(req.body) : undefined),
      );
  } catch (error) {
    const result = errorResponse(error);
    return res.status(result.status).json(result.body);
  }
}
