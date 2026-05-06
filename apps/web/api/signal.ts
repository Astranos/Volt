// Minimal WebRTC signaling relay
// Stores offers and answers temporarily for P2P connection establishment

export const config = {
  runtime: "edge",
};

// In-memory store (for development - use KV in production)
const sessions = new Map<string, {
  offer?: string;
  answer?: string;
  createdAt: number;
}>();

// Clean up old sessions (older than 5 minutes)
function cleanup() {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < fiveMinutesAgo) {
      sessions.delete(id);
    }
  }
}

export default async function handler(request: Request) {
  cleanup();

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // /api/signal or /api/signal/{sessionId} or /api/signal/{sessionId}/answer

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // POST /api/signal - Create new session with offer
  if (request.method === "POST" && pathParts.length === 2) {
    const body = await request.json();
    const { offer } = body;

    if (!offer) {
      return new Response(JSON.stringify({ error: "Missing offer" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate short session ID
    const sessionId = Math.random().toString(36).substring(2, 10);
    sessions.set(sessionId, { offer, createdAt: Date.now() });

    return new Response(JSON.stringify({ sessionId }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // GET /api/signal/{sessionId} - Get offer
  if (request.method === "GET" && pathParts.length === 3) {
    const sessionId = pathParts[2];
    const session = sessions.get(sessionId);

    if (!session?.offer) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ offer: session.offer }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // POST /api/signal/{sessionId}/answer - Submit answer
  if (request.method === "POST" && pathParts.length === 4 && pathParts[3] === "answer") {
    const sessionId = pathParts[2];
    const session = sessions.get(sessionId);

    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const body = await request.json();
    const { answer } = body;

    if (!answer) {
      return new Response(JSON.stringify({ error: "Missing answer" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    session.answer = answer;
    sessions.set(sessionId, session);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // GET /api/signal/{sessionId}/answer - Poll for answer
  if (request.method === "GET" && pathParts.length === 4 && pathParts[3] === "answer") {
    const sessionId = pathParts[2];
    const session = sessions.get(sessionId);

    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!session.answer) {
      return new Response(JSON.stringify({ answer: null }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ answer: session.answer }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
