const PASSWORD = process.env.LOG_PASSWORD || '';

export function checkAuth(url: URL): Response | null {
  const pwd = url.searchParams.get('pwd');

  if (!PASSWORD) {
    return new Response('LOG_PASSWORD not configured', { status: 500 });
  }

  if (pwd !== PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null; // Auth passed
}
