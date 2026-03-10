import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, AreaChart, Area
} from 'recharts';
import {
  Brain, Sparkles, BookOpen, Tag, Download, Upload, Lock, Unlock,
  Plus, Edit2, Trash2, Eye, EyeOff, TrendingUp, Search,
  Filter, Heart, Lightbulb, Briefcase, Calendar, X,
  MessageCircle, Zap, BarChart2, ChevronRight, ChevronDown,
  Sun, Moon, Star, Wind, Flame, Feather, RefreshCw, Settings,
  AlertCircle, CheckCircle, Clock, Archive, Layers, Activity
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

// NOTE: Model selection is server-side only (server/index.js)
// The client never specifies a model, preventing model-injection attacks.

const MOODS = [
  { value: 1, emoji: '😫', label: 'Terrible', color: '#dc2626', bg: 'rgba(220,38,38,0.15)' },
  { value: 2, emoji: '😟', label: 'Low',      color: '#ea580c', bg: 'rgba(234,88,12,0.15)' },
  { value: 3, emoji: '😐', label: 'Neutral',  color: '#ca8a04', bg: 'rgba(202,138,4,0.15)' },
  { value: 4, emoji: '😊', label: 'Good',     color: '#16a34a', bg: 'rgba(22,163,74,0.15)' },
  { value: 5, emoji: '✨', label: 'Amazing',  color: '#7c3aed', bg: 'rgba(124,58,237,0.15)' },
];

const JOURNEYS = [
  { id: 'personal',  label: 'Personal',  icon: Heart,      color: '#e11d48', accent: '#fda4af' },
  { id: 'work',      label: 'Work',      icon: Briefcase,  color: '#0284c7', accent: '#7dd3fc' },
  { id: 'books',     label: 'Reading',   icon: BookOpen,   color: '#059669', accent: '#6ee7b7' },
  { id: 'creative',  label: 'Creative',  icon: Lightbulb,  color: '#d97706', accent: '#fcd34d' },
  { id: 'learning',  label: 'Learning',  icon: Brain,      color: '#7c3aed', accent: '#c4b5fd' },
  { id: 'health',    label: 'Health',    icon: Activity,   color: '#0891b2', accent: '#67e8f9' },
];

const ENERGY_LEVELS = [
  { value: 1, label: 'Drained', icon: '🔋' },
  { value: 2, label: 'Low',     icon: '🔋' },
  { value: 3, label: 'Okay',    icon: '⚡' },
  { value: 4, label: 'Charged', icon: '⚡' },
  { value: 5, label: 'Wired',   icon: '🔥' },
];

// ─── Crypto Utilities (AES-256-GCM via Web Crypto API) ───────────────────────
//
// Uses the browser's native SubtleCrypto — no JS crypto libraries, no
// dependencies, auditable by anyone who can read MDN docs.
//
// Format stored in localStorage:
//   base64( salt[16] || iv[12] || ciphertext )
//
// Key derivation: PBKDF2-SHA-256, 310,000 iterations (OWASP 2024 recommendation)

const PBKDF2_ITERATIONS = 310_000;

const buf2b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b642buf = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const deriveKey = async (password, salt) => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const aesEncrypt = async (data, password) => {
  if (!password) return JSON.stringify(data);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(password, salt);
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  // Concatenate salt + iv + ciphertext
  const out = new Uint8Array(salt.length + iv.length + ct.byteLength);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(new Uint8Array(ct), 28);
  return buf2b64(out.buffer);
};

const aesDecrypt = async (b64, password) => {
  if (!password) { try { return JSON.parse(b64); } catch { return null; } }
  try {
    const buf  = b642buf(b64);
    const salt = buf.slice(0, 16);
    const iv   = buf.slice(16, 28);
    const ct   = buf.slice(28);
    const key  = await deriveKey(password, salt);
    const pt   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
};

// ─── Claude API — routed through local proxy, key never touches browser ───────

const callClaude = async (systemPrompt, userMessage, maxTokens = 800) => {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 503 && err.code === 'NO_API_KEY') {
      throw new Error('AI features require an Anthropic API key. Set ANTHROPIC_API_KEY in your .env file.');
    }
    if (res.status === 429) throw new Error('Rate limit hit. Wait a moment and try again.');
    throw new Error(err.error || `Proxy error: ${res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
};

// ─── Local NLP fallback ───────────────────────────────────────────────────────

const stopWords = new Set([
  'the','be','to','of','and','a','in','that','have','i','it','for',
  'not','on','with','he','as','you','do','at','this','but','his','by',
  'from','they','we','say','her','she','or','an','will','my','one','all',
  'would','there','their','was','is','am','are','can','me','so','if',
  'about','just','what','been','has','had','were','did','get','got','very',
  'more','when','then','than','also','into','only','over','know','feel',
  'felt','really','today','time','day','days','week','month',
]);

const extractKeywords = (text) => {
  const freq = {};
  text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([word, count]) => ({ word, count }));
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'auralog_v2_entries';
const SETTINGS_KEY = 'auralog_v2_settings';

const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
};

const saveSettings = (s) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

// ─── Components ───────────────────────────────────────────────────────────────

const Spinner = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const Badge = ({ children, color = '#7c3aed', style = {} }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 20,
    background: color + '22', border: `1px solid ${color}55`,
    color, fontSize: 12, fontWeight: 600, ...style
  }}>{children}</span>
);

const Card = ({ children, style = {}, onClick }) => (
  <div onClick={onClick} style={{
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 16, padding: 24,
    transition: 'all 0.2s', cursor: onClick ? 'pointer' : 'default',
    ...style
  }}>{children}</div>
);

const Button = ({ children, onClick, variant = 'primary', size = 'md', loading, disabled, style = {}, icon }) => {
  const sizes = { sm: '8px 14px', md: '10px 20px', lg: '13px 28px' };
  const variants = {
    primary: { background: 'var(--accent)', color: '#fff', border: 'none' },
    secondary: { background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' },
    ghost: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' },
    danger: { background: 'rgba(220,38,38,0.1)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)' },
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: sizes[size], borderRadius: 10, fontSize: size === 'sm' ? 13 : 14,
      fontWeight: 600, cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
      opacity: (disabled || loading) ? 0.6 : 1, fontFamily: 'inherit',
      transition: 'all 0.15s', ...variants[variant], ...style
    }}>
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
};

const Input = ({ value, onChange, placeholder, type = 'text', multiline, rows = 5, style = {} }) => {
  const base = {
    width: '100%', padding: '12px 16px',
    background: 'var(--input)', border: '1px solid var(--border)',
    borderRadius: 10, fontSize: 14, color: 'var(--text)',
    fontFamily: 'inherit', outline: 'none', resize: multiline ? 'vertical' : 'none',
    lineHeight: 1.6, boxSizing: 'border-box', ...style
  };
  return multiline
    ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={base} />
    : <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={base} />;
};

// ─── AI Panel ─────────────────────────────────────────────────────────────────

const AIInsightPanel = ({ entry, entries }) => {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('reflect');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef(null);

  const generateInsights = useCallback(async () => {
    setLoading(true);
    try {
      const context = entries.slice(0, 20).map(e =>
        `[${new Date(e.date).toLocaleDateString()} | Mood: ${e.mood}/5 | ${e.journey}] ${e.title}: ${e.content.slice(0, 200)}`
      ).join('\n');

      const result = await callClaude(
        `You are a thoughtful, psychologically-aware journal companion. Analyze journal entries and provide:
1. A brief pattern observation (2-3 sentences)
2. One non-obvious insight the user might not see themselves
3. One actionable micro-step for the next 24h
4. A "reflection question" to sit with

Be specific, not generic. Reference actual content. Be honest, not just validating.
Format as JSON: { "pattern": "...", "insight": "...", "action": "...", "question": "..." }`,
        `Recent journal entries:\n${context}\n\nCurrent entry:\n${entry.title}: ${entry.content}`,
        600
      );

      const clean = result.replace(/```json\n?|\n?```/g, '').trim();
      setInsights(JSON.parse(clean));
    } catch (e) {
      setInsights({ error: 'Could not generate insights. Check your API key.' });
    }
    setLoading(false);
  }, [entry, entries]);

  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(h => [...h, { role: 'user', content: userMsg }]);
    setChatLoading(true);

    try {
      const context = entries.slice(0, 15).map(e =>
        `[${new Date(e.date).toLocaleDateString()} | ${e.journey}] ${e.title}: ${e.content.slice(0, 150)}`
      ).join('\n');

      const history = [...chatHistory, { role: 'user', content: userMsg }];
      const messages = [
        { role: 'user', content: `Journal context:\n${context}\n\nConversation: ${userMsg}` }
      ];

      const reply = await callClaude(
        `You are a thoughtful journal companion with access to the user's journal history.
Answer questions about their patterns, growth, and experiences with specificity.
Be direct, insightful, and occasionally challenging. Max 3 sentences per response.`,
        messages[0].content,
        400
      );

      setChatHistory(h => [...h, { role: 'assistant', content: reply }]);
    } catch { setChatHistory(h => [...h, { role: 'assistant', content: 'Error reaching Claude API.' }]); }
    setChatLoading(false);

    setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 100);
  }, [chatInput, chatHistory, entries]);

  const tabs = [
    { id: 'reflect', label: 'Reflect', icon: Sparkles },
    { id: 'chat', label: 'Ask AI', icon: MessageCircle },
  ];

  return (
    <Card style={{ marginTop: 16, borderColor: '#7c3aed44' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <Button key={t.id} variant={tab === t.id ? 'primary' : 'ghost'} size="sm"
              onClick={() => setTab(t.id)} icon={<t.icon size={14} />}>
              {t.label}
            </Button>
          ))}
        </div>
        {tab === 'reflect' && !insights && (
          <Button size="sm" onClick={generateInsights} loading={loading} icon={<Zap size={14} />}>
            Analyze
          </Button>
        )}
        {tab === 'reflect' && insights && (
          <Button size="sm" variant="ghost" onClick={() => setInsights(null)} icon={<RefreshCw size={14} />}>
            Refresh
          </Button>
        )}
      </div>

      {tab === 'reflect' && (
        <div>
          {!insights && !loading && (
            <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
              Click Analyze to get AI-powered reflection on this entry and your recent patterns.
            </p>
          )}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '20px 0' }}>
              <Spinner /> Thinking...
            </div>
          )}
          {insights && !insights.error && (
            <div style={{ display: 'grid', gap: 14 }}>
              {[
                { key: 'pattern', label: '📊 Pattern', color: '#0284c7' },
                { key: 'insight', label: '💡 Insight', color: '#7c3aed' },
                { key: 'action', label: '⚡ Next 24h', color: '#059669' },
                { key: 'question', label: '🤔 Reflect on', color: '#d97706' },
              ].map(({ key, label, color }) => insights[key] && (
                <div key={key} style={{
                  padding: '12px 16px',
                  background: color + '11',
                  borderLeft: `3px solid ${color}`,
                  borderRadius: '0 8px 8px 0',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>{insights[key]}</div>
                </div>
              ))}
            </div>
          )}
          {insights?.error && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#f87171', fontSize: 14 }}>
              <AlertCircle size={16} /> {insights.error}
            </div>
          )}
        </div>
      )}

      {tab === 'chat' && (
        <div>
          <div ref={chatRef} style={{
            height: 200, overflowY: 'auto', display: 'flex',
            flexDirection: 'column', gap: 10, marginBottom: 12,
            padding: '4px 0'
          }}>
            {chatHistory.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingTop: 60 }}>
                Ask anything about your journal patterns, recurring themes, or past entries.
              </p>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%', padding: '10px 14px', borderRadius: 12, fontSize: 14,
                background: m.role === 'user' ? 'var(--accent)' : 'var(--card-alt)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
              }}>{m.content}</div>
            ))}
            {chatLoading && (
              <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: 13, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Spinner size={14} /> Thinking...
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="What patterns do you see in my anxiety entries?"
              style={{ flex: 1 }}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
            />
            <Button onClick={sendChat} loading={chatLoading} disabled={!chatInput.trim()}>
              Send
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

// ─── Weekly Digest ─────────────────────────────────────────────────────────────

const WeeklyDigest = ({ entries }) => {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(false);

  const lastWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return entries.filter(e => new Date(e.date).getTime() > cutoff);
  }, [entries]);

  const generate = async () => {
    setLoading(true);
    try {
      const context = lastWeek.map(e =>
        `[${new Date(e.date).toLocaleDateString()} | Mood ${e.mood}/5 | Energy ${e.energy || '?'}/5 | ${e.journey}]\nTitle: ${e.title}\n${e.content.slice(0, 300)}`
      ).join('\n\n---\n\n');

      const result = await callClaude(
        `You are an insightful weekly journal analyst. Create a concise weekly review.
Format as JSON with keys:
- summary: 2-3 sentence narrative of the week
- highlights: array of 2-3 notable moments (strings)
- patterns: array of 2 behavioral/emotional patterns (strings)
- growth: one evidence-based growth observation
- nextWeek: one specific intention for next week based on patterns
Be specific. Reference actual events and dates. Be an honest mirror, not a cheerleader.`,
        `Here are my journal entries from the past 7 days:\n\n${context}`,
        800
      );

      const clean = result.replace(/```json\n?|\n?```/g, '').trim();
      setDigest(JSON.parse(clean));
    } catch (e) {
      setDigest({ error: 'Could not generate digest.' });
    }
    setLoading(false);
  };

  if (lastWeek.length < 2) return (
    <Card>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
        <Archive size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
        <p style={{ margin: 0, fontSize: 14 }}>Write at least 2 entries this week to generate a digest.</p>
      </div>
    </Card>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Weekly Digest</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {lastWeek.length} entries this week
          </p>
        </div>
        <Button onClick={generate} loading={loading} icon={<Sparkles size={14} />}>
          {digest ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      {!digest && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Get an AI-synthesized view of your week — patterns, highlights, and what to focus on next.
        </p>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '10px 0' }}>
          <Spinner /> Synthesizing your week...
        </div>
      )}

      {digest && !digest.error && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: '14px 16px', background: 'var(--card-alt)', borderRadius: 10, fontSize: 15, lineHeight: 1.7 }}>
            {digest.summary}
          </div>
          {digest.highlights && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Highlights
              </div>
              {digest.highlights.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, fontSize: 14 }}>
                  <Star size={14} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
                  {h}
                </div>
              ))}
            </div>
          )}
          {digest.patterns && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Patterns
              </div>
              {digest.patterns.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, fontSize: 14 }}>
                  <TrendingUp size={14} style={{ color: '#7c3aed', flexShrink: 0, marginTop: 2 }} />
                  {p}
                </div>
              ))}
            </div>
          )}
          {digest.growth && (
            <div style={{ padding: '12px 16px', background: 'rgba(5,150,105,0.1)', borderLeft: '3px solid #059669', borderRadius: '0 8px 8px 0', fontSize: 14 }}>
              <span style={{ fontWeight: 700, color: '#059669' }}>Growth: </span>{digest.growth}
            </div>
          )}
          {digest.nextWeek && (
            <div style={{ padding: '12px 16px', background: 'rgba(124,58,237,0.1)', borderLeft: '3px solid #7c3aed', borderRadius: '0 8px 8px 0', fontSize: 14 }}>
              <span style={{ fontWeight: 700, color: '#7c3aed' }}>Intention: </span>{digest.nextWeek}
            </div>
          )}
        </div>
      )}

      {digest?.error && (
        <div style={{ color: '#f87171', fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertCircle size={16} /> {digest.error}
        </div>
      )}
    </Card>
  );
};

// ─── Smart Prompt Generator ────────────────────────────────────────────────────

const SmartPromptGenerator = ({ entries, mood, journey, onSelect }) => {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const recentContext = entries.slice(0, 5).map(e =>
        `[${e.journey}] ${e.title}: ${e.content.slice(0, 120)}`
      ).join('\n');

      const moodLabel = MOODS.find(m => m.value === mood)?.label || 'Neutral';
      const journeyLabel = JOURNEYS.find(j => j.id === journey)?.label || 'Personal';

      const result = await callClaude(
        `Generate 3 highly specific journaling prompts. They should:
- Be tailored to the user's current mood and recent entries
- NOT be generic (avoid "What are you grateful for?")
- Build on themes from recent entries when relevant
- Vary in depth: one surface-level, one medium, one deep/challenging
Format as JSON array: ["prompt1", "prompt2", "prompt3"]`,
        `Current mood: ${moodLabel}/5\nJourney: ${journeyLabel}\nRecent entries:\n${recentContext}`,
        300
      );

      const clean = result.replace(/```json\n?|\n?```/g, '').trim();
      setPrompts(JSON.parse(clean));
    } catch {
      setPrompts([
        'What specific moment today shifted your perspective?',
        'What are you avoiding thinking about right now?',
        'If you could redo one thing from the last 48 hours, what would it be and why?'
      ]);
    }
    setLoading(false);
  }, [entries, mood, journey]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Writing Prompts
        </label>
        <Button size="sm" variant="ghost" onClick={generate} loading={loading} icon={<Zap size={12} />}>
          AI Generate
        </Button>
      </div>

      {prompts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {prompts.map((p, i) => (
            <button key={i} onClick={() => onSelect(p)} style={{
              textAlign: 'left', padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: 'var(--card-alt)', border: '1px solid var(--border)',
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s', lineHeight: 1.5
            }}>
              {p}
            </button>
          ))}
        </div>
      )}

      {prompts.length === 0 && !loading && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Click AI Generate for prompts tailored to your mood and history.
        </p>
      )}
    </div>
  );
};

// ─── Analytics ────────────────────────────────────────────────────────────────

const Analytics = ({ entries }) => {
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const stats = useMemo(() => {
    if (!entries.length) return null;

    const avgMood = entries.reduce((s, e) => s + e.mood, 0) / entries.length;
    const moodTrend = entries.slice(0, 14).reverse().map(e => ({
      date: new Date(e.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      mood: e.mood,
      energy: e.energy || null,
    }));

    const journeyDist = JOURNEYS.map(j => ({
      name: j.label, value: entries.filter(e => e.journey === j.id).length, color: j.color
    })).filter(j => j.value > 0);

    const moodDist = MOODS.map(m => ({
      name: m.label, value: entries.filter(e => e.mood === m.value).length, color: m.color
    }));

    const dayOfWeek = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => {
      const dayEntries = entries.filter(e => new Date(e.date).toLocaleDateString('en',{weekday:'short'}) === day);
      return { day, avg: dayEntries.length ? (dayEntries.reduce((s,e)=>s+e.mood,0)/dayEntries.length).toFixed(1) : null, count: dayEntries.length };
    }).filter(d => d.count > 0);

    const keywords = extractKeywords(entries.map(e => e.content + ' ' + e.title).join(' '));

    const streak = (() => {
      let s = 0, d = new Date();
      d.setHours(0,0,0,0);
      while (true) {
        const hasEntry = entries.some(e => {
          const ed = new Date(e.date); ed.setHours(0,0,0,0);
          return ed.getTime() === d.getTime();
        });
        if (!hasEntry) break;
        s++; d.setDate(d.getDate() - 1);
      }
      return s;
    })();

    const monthlyTrend = (() => {
      const byMonth = {};
      entries.forEach(e => {
        const k = new Date(e.date).toLocaleDateString('en', { month: 'short', year: '2-digit' });
        if (!byMonth[k]) byMonth[k] = { sum: 0, count: 0 };
        byMonth[k].sum += e.mood;
        byMonth[k].count++;
      });
      return Object.entries(byMonth).map(([month, d]) => ({
        month, avg: (d.sum / d.count).toFixed(2), count: d.count
      })).slice(-6);
    })();

    return { avgMood: avgMood.toFixed(1), moodTrend, journeyDist, moodDist, dayOfWeek, keywords, streak, monthlyTrend };
  }, [entries]);

  const generateAISummary = async () => {
    setAiLoading(true);
    try {
      const recentText = entries.slice(0, 20).map(e =>
        `[${new Date(e.date).toLocaleDateString()} | Mood: ${e.mood} | ${e.journey}] ${e.title}: ${e.content.slice(0, 200)}`
      ).join('\n');

      const result = await callClaude(
        `You are a data-driven journal analyst. Provide a psychologically-informed analysis.
Format as JSON with:
- narrative: 3-4 sentence analysis of overall emotional trajectory
- strengths: array of 2 genuine strengths visible in entries
- blindspots: array of 2 patterns the user may not be aware of
- trajectory: "improving" | "stable" | "declining" with a one-sentence justification
- recommendation: one specific, evidence-based recommendation
Be honest and specific. Avoid vague platitudes.`,
        `Journal entries (${entries.length} total):\n${recentText}\nAvg mood: ${stats?.avgMood}/5`,
        700
      );

      const clean = result.replace(/```json\n?|\n?```/g, '').trim();
      setAiSummary(JSON.parse(clean));
    } catch {
      setAiSummary({ error: 'Could not generate AI analysis.' });
    }
    setAiLoading(false);
  };

  if (!stats) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
      <BarChart2 size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
      <p>No entries yet. Start journaling to unlock analytics.</p>
    </div>
  );

  const TOOLTIP_STYLE = {
    contentStyle: {
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 10, fontSize: 13, fontFamily: 'inherit'
    }
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
        {[
          { label: 'Entries', value: entries.length, icon: BookOpen, color: '#7c3aed' },
          { label: 'Avg Mood', value: `${stats.avgMood}/5`, icon: TrendingUp, color: '#0284c7' },
          { label: 'Day Streak', value: stats.streak, icon: Flame, color: '#d97706' },
          { label: 'Journeys', value: stats.journeyDist.length, icon: Layers, color: '#059669' },
        ].map(k => (
          <Card key={k.label} style={{ textAlign: 'center' }}>
            <k.icon size={20} style={{ color: k.color, marginBottom: 8 }} />
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>{k.label}</div>
          </Card>
        ))}
      </div>

      {/* AI Analysis */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={18} style={{ color: '#7c3aed' }} /> AI Pattern Analysis
          </h3>
          <Button size="sm" onClick={generateAISummary} loading={aiLoading} icon={<Sparkles size={14} />}>
            {aiSummary ? 'Refresh' : 'Analyze All'}
          </Button>
        </div>

        {!aiSummary && !aiLoading && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Deep analysis of all your entries — emotional trajectory, patterns, blindspots, and personalized recommendations.
          </p>
        )}
        {aiLoading && <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)', fontSize: 14 }}><Spinner /> Analyzing {entries.length} entries...</div>}
        {aiSummary && !aiSummary.error && (
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ fontSize: 15, lineHeight: 1.7, margin: 0 }}>{aiSummary.narrative}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ padding: '12px 14px', background: 'rgba(5,150,105,0.08)', borderRadius: 10, border: '1px solid rgba(5,150,105,0.2)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 8, textTransform: 'uppercase' }}>Strengths</div>
                {aiSummary.strengths?.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4, display: 'flex', gap: 6 }}><CheckCircle size={13} style={{ color: '#059669', flexShrink: 0, marginTop: 1 }} />{s}</div>)}
              </div>
              <div style={{ padding: '12px 14px', background: 'rgba(220,38,38,0.08)', borderRadius: 10, border: '1px solid rgba(220,38,38,0.2)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 8, textTransform: 'uppercase' }}>Blindspots</div>
                {aiSummary.blindspots?.map((s, i) => <div key={i} style={{ fontSize: 13, marginBottom: 4, display: 'flex', gap: 6 }}><AlertCircle size={13} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />{s}</div>)}
              </div>
            </div>
            {aiSummary.recommendation && (
              <div style={{ padding: '12px 16px', background: 'rgba(124,58,237,0.1)', borderLeft: '3px solid #7c3aed', borderRadius: '0 8px 8px 0', fontSize: 14 }}>
                <strong style={{ color: '#7c3aed' }}>Recommendation: </strong>{aiSummary.recommendation}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Mood trend */}
      <Card>
        <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>Mood Over Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={stats.moodTrend}>
            <defs>
              <linearGradient id="moodGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
            <YAxis domain={[1, 5]} ticks={[1,2,3,4,5]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="mood" stroke="#7c3aed" strokeWidth={2.5} fill="url(#moodGrad)" dot={{ fill: '#7c3aed', r: 4 }} />
            {stats.moodTrend.some(d => d.energy) && (
              <Line type="monotone" dataKey="energy" stroke="#d97706" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        {/* Journey dist */}
        <Card>
          <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>Journey Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={stats.journeyDist} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                dataKey="value" paddingAngle={4}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {stats.journeyDist.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Day of week */}
        <Card>
          <h3 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700 }}>Best Days</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.dayOfWeek} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis domain={[1, 5]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="avg" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Keywords */}
      <Card>
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>Recurring Themes</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {stats.keywords.map((kw, i) => (
            <div key={kw.word} style={{
              padding: '8px 16px', borderRadius: 20,
              background: `rgba(124,58,237,${0.25 - i * 0.015})`,
              border: '1px solid rgba(124,58,237,0.3)',
              fontSize: Math.max(12, 18 - i),
              fontWeight: 600, color: 'var(--text)'
            }}>
              {kw.word} <span style={{ opacity: 0.5, fontSize: 11 }}>×{kw.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ─── Settings ─────────────────────────────────────────────────────────────────

const SettingsPanel = ({ settings, onSave }) => {
  const [local, setLocal] = useState({ ...settings });

  return (
    <div style={{ maxWidth: 560 }}>
      <Card>
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>Settings</h3>

        {/* Encryption */}
        <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Encryption</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            XOR-encrypt entries at rest. Password cannot be recovered — keep it safe.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input type="password" value={local.encryptPassword || ''}
              onChange={e => setLocal(p => ({ ...p, encryptPassword: e.target.value }))}
              placeholder="Set encryption password..."
              style={{ flex: 1 }}
            />
            <Button variant={local.encryptEnabled ? 'primary' : 'secondary'}
              icon={local.encryptEnabled ? <Lock size={14} /> : <Unlock size={14} />}
              onClick={() => setLocal(p => ({ ...p, encryptEnabled: !p.encryptEnabled }))}>
              {local.encryptEnabled ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
        </div>

        {/* Theme */}
        <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Theme</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['dark', 'light', 'oled'].map(t => (
              <Button key={t} variant={local.theme === t ? 'primary' : 'secondary'}
                size="sm" onClick={() => setLocal(p => ({ ...p, theme: t }))}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Data */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Data</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" icon={<Download size={13} />}
              onClick={() => onSave({ ...local, exportNow: true })}>
              Export JSON
            </Button>
            <Button variant="secondary" size="sm" icon={<Upload size={13} />}
              onClick={() => document.getElementById('import-file').click()}>
              Import JSON
            </Button>
            <input id="import-file" type="file" accept=".json" style={{ display: 'none' }}
              onChange={e => onSave({ ...local, importFile: e.target.files[0] })} />
          </div>
        </div>

        <Button onClick={() => onSave(local)}>Save Settings</Button>
      </Card>
    </div>
  );
};

// ─── Entry Editor ─────────────────────────────────────────────────────────────

const EntryEditor = ({ entry, entries, onSave, onCancel }) => {
  const [form, setForm] = useState(entry || {
    mood: 3, energy: 3, title: '', content: '', tags: [], journey: 'personal', prompt: ''
  });
  const [tagInput, setTagInput] = useState('');
  const [showAI, setShowAI] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const addTag = () => {
    if (tagInput.trim() && !form.tags?.includes(tagInput.trim())) {
      set('tags', [...(form.tags || []), tagInput.trim()]);
      setTagInput('');
    }
  };

  const selectedJourney = JOURNEYS.find(j => j.id === form.journey);

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Journey */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 10 }}>
          Journey
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {JOURNEYS.map(j => {
            const Icon = j.icon;
            const active = form.journey === j.id;
            return (
              <button key={j.id} onClick={() => set('journey', j.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                borderRadius: 10, border: `1.5px solid ${active ? j.color : 'var(--border)'}`,
                background: active ? j.color + '22' : 'var(--card)',
                color: active ? j.color : 'var(--text-muted)', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s'
              }}>
                <Icon size={14} /> {j.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mood + Energy */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 10 }}>
            Mood
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {MOODS.map(m => (
              <button key={m.value} onClick={() => set('mood', m.value)} style={{
                flex: 1, padding: '10px 4px', borderRadius: 10,
                border: `1.5px solid ${form.mood === m.value ? m.color : 'var(--border)'}`,
                background: form.mood === m.value ? m.bg : 'var(--card)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s', textAlign: 'center',
              }}>
                <div style={{ fontSize: 22 }}>{m.emoji}</div>
                <div style={{ fontSize: 10, color: form.mood === m.value ? m.color : 'var(--text-muted)', fontWeight: 600, marginTop: 3 }}>
                  {m.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 10 }}>
            Energy
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {ENERGY_LEVELS.map(e => (
              <button key={e.value} onClick={() => set('energy', e.value)} style={{
                flex: 1, padding: '10px 4px', borderRadius: 10,
                border: `1.5px solid ${form.energy === e.value ? '#d97706' : 'var(--border)'}`,
                background: form.energy === e.value ? 'rgba(217,119,6,0.15)' : 'var(--card)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s', textAlign: 'center',
              }}>
                <div style={{ fontSize: 18 }}>{e.icon}</div>
                <div style={{ fontSize: 10, color: form.energy === e.value ? '#d97706' : 'var(--text-muted)', fontWeight: 600, marginTop: 3 }}>
                  {e.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Smart prompts */}
      <SmartPromptGenerator entries={entries} mood={form.mood} journey={form.journey}
        onSelect={(p) => set('content', form.content ? form.content + '\n\n' + p + '\n' : p + '\n')} />

      {/* Title */}
      <div style={{ marginBottom: 16 }}>
        <Input value={form.title} onChange={e => set('title', e.target.value)}
          placeholder="Entry title..." style={{ fontSize: 18, fontWeight: 600 }} />
      </div>

      {/* Content */}
      <div style={{ marginBottom: 16 }}>
        <Input multiline value={form.content} onChange={e => set('content', e.target.value)}
          placeholder="Write freely..." rows={10} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {form.content.split(/\s+/).filter(Boolean).length} words
          </span>
        </div>
      </div>

      {/* Tags */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
            placeholder="Add tag..." style={{ flex: 1 }}
            onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addTag())} />
          <Button variant="secondary" onClick={addTag}>Add</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(form.tags || []).map(t => (
            <span key={t} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 20,
              background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600
            }}>
              #{t}
              <button onClick={() => set('tags', form.tags.filter(x => x !== t))} style={{
                background: 'none', border: 'none', color: '#fff',
                cursor: 'pointer', padding: 0, display: 'flex', fontSize: 16, lineHeight: 1
              }}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={() => {
          if (!form.title.trim()) return alert('Please add a title');
          onSave(form);
        }} icon={<CheckCircle size={14} />}>
          {entry?.id ? 'Update' : 'Save Entry'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => setShowAI(!showAI)} icon={<Sparkles size={14} />}>
          AI Reflect
        </Button>
      </div>

      {showAI && form.content.length > 20 && (
        <AIInsightPanel entry={{ ...form, date: new Date().toISOString() }} entries={entries} />
      )}
    </div>
  );
};

// ─── Semantic Search ───────────────────────────────────────────────────────────

const SemanticSearch = ({ entries, onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('local'); // 'local' | 'ai'

  const localSearch = useCallback((q) => {
    if (!q.trim()) { setResults([]); return; }
    const ql = q.toLowerCase();
    const scored = entries.map(e => {
      let score = 0;
      if (e.title.toLowerCase().includes(ql)) score += 3;
      if (e.content.toLowerCase().includes(ql)) score += 1;
      if (e.tags?.some(t => t.toLowerCase().includes(ql))) score += 2;
      return { ...e, score };
    }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
    setResults(scored.slice(0, 10));
  }, [entries]);

  const aiSearch = useCallback(async (q) => {
    if (!q.trim() || !entries.length) return;
    setLoading(true);
    try {
      const index = entries.map((e, i) => `[${i}] ${e.title}: ${e.content.slice(0, 120)}`).join('\n');
      const result = await callClaude(
        `You are a semantic search engine for a journal. Given a query, return the indices of the most relevant entries.
Return ONLY a JSON array of indices (e.g., [2, 5, 0]). Max 5 results. Return [] if nothing is relevant.`,
        `Query: "${q}"\n\nEntries:\n${index}`,
        100
      );
      const clean = result.replace(/```json\n?|\n?```/g, '').trim();
      const indices = JSON.parse(clean);
      setResults(indices.map(i => entries[i]).filter(Boolean));
    } catch { localSearch(q); }
    setLoading(false);
  }, [entries, localSearch]);

  useEffect(() => {
    if (mode === 'local') localSearch(query);
  }, [query, mode, localSearch]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <Input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search entries..."
            style={{ paddingLeft: 40 }}
            onKeyPress={e => e.key === 'Enter' && mode === 'ai' && aiSearch(query)}
          />
        </div>
        <Button variant={mode === 'ai' ? 'primary' : 'secondary'} size="sm"
          onClick={() => { setMode(m => m === 'ai' ? 'local' : 'ai'); setResults([]); }}
          icon={<Brain size={14} />}>
          {mode === 'ai' ? 'AI' : 'Text'}
        </Button>
        {mode === 'ai' && (
          <Button size="sm" onClick={() => aiSearch(query)} loading={loading}>
            Search
          </Button>
        )}
      </div>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map(e => {
            const mood = MOODS.find(m => m.value === e.mood);
            const journey = JOURNEYS.find(j => j.id === e.journey);
            return (
              <div key={e.id} onClick={() => onSelect(e)} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '14px 16px', borderRadius: 10,
                background: 'var(--card)', border: '1px solid var(--border)',
                cursor: 'pointer', transition: 'all 0.15s'
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{mood?.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{e.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.content.slice(0, 100)}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <Badge color={journey?.color}>{journey?.label}</Badge>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {new Date(e.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function AuraLog() {
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState({ theme: 'dark', encryptEnabled: false, encryptPassword: '' });
  const [view, setView] = useState('home');
  const [editingEntry, setEditingEntry] = useState(null);
  const [locked, setLocked] = useState(false);
  const [unlockPw, setUnlockPw] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [filterJourney, setFilterJourney] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [aiEnabled, setAiEnabled] = useState(null); // null = unknown, true/false after probe

  // Probe proxy status (tells us if API key is configured server-side)
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setAiEnabled(d.aiEnabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // Load — async because AES-GCM decrypt is async
  useEffect(() => {
    const load = async () => {
      const s = loadSettings();
      if (s) setSettings(prev => ({ ...prev, ...s }));

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      if (s?.encryptEnabled) {
        if (s?.encryptPassword) {
          const dec = await aesDecrypt(raw, s.encryptPassword);
          if (dec) setEntries(dec);
          else setLocked(true);
        } else {
          setLocked(true);
        }
      } else {
        try { setEntries(JSON.parse(raw)); } catch {}
      }
    };
    load();
  }, []);

  // Save — async because AES-GCM encrypt is async
  useEffect(() => {
    if (locked) return;
    const save = async () => {
      const data = settings.encryptEnabled && settings.encryptPassword
        ? await aesEncrypt(entries, settings.encryptPassword)
        : JSON.stringify(entries);
      localStorage.setItem(STORAGE_KEY, data);
      saveSettings(settings);
    };
    save();
  }, [entries, settings, locked]);

  // Theme
  useEffect(() => {
    const themes = {
      dark:  { '--bg': '#0f0f13', '--card': '#1a1a22', '--card-alt': '#22222e', '--border': '#2a2a38', '--text': '#e8e8f0', '--text-muted': '#6b6b82', '--input': '#16161e', '--accent': '#7c3aed' },
      light: { '--bg': '#f5f5f7', '--card': '#ffffff',  '--card-alt': '#f0f0f5', '--border': '#e0e0ea', '--text': '#1a1a2e', '--text-muted': '#6b6b82', '--input': '#fafafa',  '--accent': '#7c3aed' },
      oled:  { '--bg': '#000000', '--card': '#0a0a0a',  '--card-alt': '#111111', '--border': '#1f1f1f', '--text': '#ffffff',  '--text-muted': '#555555', '--input': '#050505',  '--accent': '#8b5cf6' },
    };
    const t = themes[settings.theme] || themes.dark;
    Object.entries(t).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    document.body.style.background = t['--bg'];
    document.body.style.color = t['--text'];
  }, [settings.theme]);

  const handleUnlock = async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && unlockPw) {
      const dec = await aesDecrypt(raw, unlockPw);
      if (dec) {
        setEntries(dec);
        setSettings(p => ({ ...p, encryptPassword: unlockPw }));
        setLocked(false);
        setUnlockError('');
      } else {
        setUnlockError('Incorrect password');
      }
    }
  };

  const saveEntry = (form) => {
    const now = new Date().toISOString();
    if (editingEntry?.id) {
      setEntries(prev => prev.map(e => e.id === editingEntry.id ? { ...form, id: e.id, date: e.date, updatedAt: now } : e));
    } else {
      setEntries(prev => [{ ...form, id: Date.now(), date: now }, ...prev]);
    }
    setEditingEntry(null);
    setView('entries');
  };

  const deleteEntry = (id) => {
    if (confirm('Delete this entry?')) setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleSettings = (s) => {
    if (s.exportNow) {
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `auralog-${new Date().toISOString().split('T')[0]}.json`; a.click();
      return;
    }
    if (s.importFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (Array.isArray(imported)) {
            if (confirm(`Import ${imported.length} entries? This will merge with existing entries.`)) {
              setEntries(prev => {
                const existing = new Set(prev.map(e => e.id));
                return [...prev, ...imported.filter(e => !existing.has(e.id))];
              });
            }
          }
        } catch { alert('Invalid JSON file'); }
      };
      reader.readAsText(s.importFile);
      return;
    }
    setSettings(s);
  };

  const allTags = [...new Set(entries.flatMap(e => e.tags || []))];
  const filteredEntries = entries.filter(e => {
    const mj = !filterJourney || e.journey === filterJourney;
    const mt = !filterTag || e.tags?.includes(filterTag);
    return mj && mt;
  });

  // Locked screen
  if (locked) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'inherit' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'Bricolage Grotesque', sans-serif; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <Card style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <Lock size={40} style={{ color: '#7c3aed', marginBottom: 16 }} />
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>Journal Locked</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Enter your password to access your entries.</p>
        <Input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)}
          placeholder="Password" style={{ marginBottom: 8 }}
          onKeyPress={e => e.key === 'Enter' && handleUnlock()} />
        {unlockError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{unlockError}</div>}
        <Button onClick={handleUnlock} style={{ width: '100%', justifyContent: 'center' }}>Unlock</Button>
      </Card>
    </div>
  );

  const NAV = [
    { id: 'home',    label: 'Home',     icon: Flame },
    { id: 'new',     label: 'Write',    icon: Feather },
    { id: 'entries', label: 'Entries',  icon: BookOpen },
    { id: 'search',  label: 'Search',   icon: Search },
    { id: 'insights',label: 'Insights', icon: TrendingUp },
    { id: 'settings',label: 'Settings', icon: Settings },
  ];

  const todayEntries = entries.filter(e => {
    const d = new Date(e.date); const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'inherit' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Bricolage Grotesque', sans-serif; color: var(--text); }
        ::placeholder { color: var(--text-muted); }
        select, input, textarea { color: var(--text) !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        button:hover { filter: brightness(1.1); }
        .nav-btn:hover { background: var(--card-alt) !important; }
      `}</style>

      {/* Sidebar */}
      <div style={{
        position: 'fixed', left: 0, top: 0, bottom: 0, width: 220,
        background: 'var(--card)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', padding: '0 12px', zIndex: 100
      }}>
        <div style={{ padding: '28px 8px 20px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: '#7c3aed', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Brain size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>AuraLog</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entries.length} entries</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
          {NAV.map(n => {
            const Icon = n.icon;
            const active = view === n.id || (n.id === 'new' && view === 'edit');
            return (
              <button key={n.id} className="nav-btn" onClick={() => {
                if (n.id === 'new') { setEditingEntry(null); }
                setView(n.id === 'new' ? 'edit' : n.id);
              }} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: active ? 700 : 500, transition: 'all 0.15s',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-muted)',
              }}>
                <Icon size={16} /> {n.label}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: '12px 8px 20px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* AI status — reflects server-side key config */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderRadius: 8, fontSize: 12, color: 'var(--text-muted)',
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: aiEnabled === null ? '#6b6b82' : aiEnabled ? '#059669' : '#dc2626',
            }} />
            {aiEnabled === null ? 'Checking AI...' : aiEnabled ? 'AI ready' : 'AI offline'}
          </div>
          {/* Encryption status */}
          <button onClick={() => { setView('settings'); }} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderRadius: 8, border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
            textAlign: 'left',
          }}>
            {settings.encryptEnabled ? <Lock size={12} /> : <Unlock size={12} />}
            {settings.encryptEnabled ? 'AES-256 on' : 'Unencrypted'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ marginLeft: 220, minHeight: '100vh' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 40px' }}>

          {/* HOME */}
          {view === 'home' && (
            <div>
              <div style={{ marginBottom: 32 }}>
                <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>
                  {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
                </h1>
                <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 15 }}>
                  {todayEntries.length === 0 ? "You haven't written today yet." : `${todayEntries.length} ${todayEntries.length === 1 ? 'entry' : 'entries'} today.`}
                </p>
              </div>

              <div style={{ display: 'grid', gap: 24 }}>
                {/* Quick write CTA */}
                <div onClick={() => { setEditingEntry(null); setView('edit'); }} style={{
                  padding: '28px 32px', borderRadius: 16, cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed22 0%, #0284c722 100%)',
                  border: '1px solid #7c3aed44', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Write an entry</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>What's on your mind?</div>
                  </div>
                  <Feather size={28} style={{ color: '#7c3aed', opacity: 0.7 }} />
                </div>

                {/* Recent entries */}
                {entries.length > 0 && (
                  <div>
                    <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent
                    </h3>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {entries.slice(0, 5).map(e => {
                        const mood = MOODS.find(m => m.value === e.mood);
                        const journey = JOURNEYS.find(j => j.id === e.journey);
                        return (
                          <Card key={e.id} onClick={() => { setSelectedEntry(e); setView('read'); }} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 28, flexShrink: 0 }}>{mood?.emoji}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{e.title}</div>
                              <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {e.content.slice(0, 100)}
                              </div>
                            </div>
                            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                              <Badge color={journey?.color}>{journey?.label}</Badge>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                {new Date(e.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Weekly digest */}
                <WeeklyDigest entries={entries} />
              </div>
            </div>
          )}

          {/* WRITE / EDIT */}
          {view === 'edit' && (
            <div>
              <div style={{ marginBottom: 28 }}>
                <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>
                  {editingEntry ? 'Edit Entry' : 'New Entry'}
                </h1>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
                  {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <EntryEditor
                entry={editingEntry} entries={entries}
                onSave={saveEntry}
                onCancel={() => setView(editingEntry ? 'read' : 'home')}
              />
            </div>
          )}

          {/* READ */}
          {view === 'read' && selectedEntry && (() => {
            const e = selectedEntry;
            const mood = MOODS.find(m => m.value === e.mood);
            const journey = JOURNEYS.find(j => j.id === e.journey);
            const JIcon = journey?.icon || Heart;
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <Button variant="ghost" onClick={() => setView('entries')} icon={<ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />}>
                    Back
                  </Button>
                  <div style={{ flex: 1 }} />
                  <Button variant="secondary" size="sm" icon={<Edit2 size={13} />}
                    onClick={() => { setEditingEntry(e); setView('edit'); }}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" icon={<Trash2 size={13} />}
                    onClick={() => { deleteEntry(e.id); setView('entries'); }}>
                    Delete
                  </Button>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: 40 }}>{mood?.emoji}</span>
                    <div>
                      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{e.title}</h1>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Badge color={journey?.color}><JIcon size={11} />{journey?.label}</Badge>
                        <Badge color={mood?.color}>{mood?.label}</Badge>
                        {e.energy && <Badge color="#d97706">⚡ Energy {e.energy}/5</Badge>}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(e.date).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <Card style={{ marginBottom: 16 }}>
                  <p style={{ margin: 0, fontSize: 16, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{e.content}</p>
                </Card>

                {e.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {e.tags.map(t => <Badge key={t} color="#7c3aed">#{t}</Badge>)}
                  </div>
                )}

                <AIInsightPanel entry={e} entries={entries} />
              </div>
            );
          })()}

          {/* ENTRIES */}
          {view === 'entries' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>
                  All Entries
                </h1>
                <Button icon={<Plus size={14} />} onClick={() => { setEditingEntry(null); setView('edit'); }}>
                  New Entry
                </Button>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                <Button variant={!filterJourney ? 'primary' : 'secondary'} size="sm"
                  onClick={() => setFilterJourney('')}>All</Button>
                {JOURNEYS.filter(j => entries.some(e => e.journey === j.id)).map(j => {
                  const Icon = j.icon;
                  return (
                    <Button key={j.id} variant={filterJourney === j.id ? 'primary' : 'secondary'} size="sm"
                      icon={<Icon size={12} />} onClick={() => setFilterJourney(filterJourney === j.id ? '' : j.id)}
                      style={filterJourney === j.id ? { background: j.color, borderColor: j.color } : {}}>
                      {j.label}
                    </Button>
                  );
                })}
              </div>

              {filteredEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <p style={{ margin: 0 }}>No entries yet. Start writing!</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {filteredEntries.map(e => {
                    const mood = MOODS.find(m => m.value === e.mood);
                    const journey = JOURNEYS.find(j => j.id === e.journey);
                    const JIcon = journey?.icon || Heart;
                    return (
                      <Card key={e.id} onClick={() => { setSelectedEntry(e); setView('read'); }}
                        style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 30, flexShrink: 0 }}>{mood?.emoji}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 15 }}>{e.title}</span>
                            <Badge color={journey?.color} style={{ fontSize: 11 }}><JIcon size={10} />{journey?.label}</Badge>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.content.slice(0, 120)}
                          </div>
                          {e.tags?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                              {e.tags.slice(0, 4).map(t => <Badge key={t} color="#6b6b82" style={{ fontSize: 11 }}>#{t}</Badge>)}
                            </div>
                          )}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {new Date(e.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={e2 => { e2.stopPropagation(); setEditingEntry(e); setView('edit'); }} style={{
                              padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card-alt)',
                              color: 'var(--text-muted)', cursor: 'pointer', display: 'flex'
                            }}><Edit2 size={12} /></button>
                            <button onClick={e2 => { e2.stopPropagation(); deleteEntry(e.id); }} style={{
                              padding: 6, borderRadius: 6, border: '1px solid rgba(220,38,38,0.3)', background: 'rgba(220,38,38,0.1)',
                              color: '#f87171', cursor: 'pointer', display: 'flex'
                            }}><Trash2 size={12} /></button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SEARCH */}
          {view === 'search' && (
            <div>
              <h1 style={{ margin: '0 0 24px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Search</h1>
              <SemanticSearch entries={entries} onSelect={(e) => { setSelectedEntry(e); setView('read'); }} />
            </div>
          )}

          {/* INSIGHTS */}
          {view === 'insights' && (
            <div>
              <h1 style={{ margin: '0 0 24px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Insights</h1>
              <Analytics entries={entries} />
            </div>
          )}

          {/* SETTINGS */}
          {view === 'settings' && (
            <div>
              <h1 style={{ margin: '0 0 24px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>Settings</h1>
              <SettingsPanel settings={settings} onSave={handleSettings} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
