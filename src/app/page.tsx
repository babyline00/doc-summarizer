"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Link as LinkIcon,
  Youtube,
  Type,
  Send,
  Loader2,
  Trash2,
  Plus,
  Highlighter,
  MessageSquare,
  Files,
  Layers,
  BookOpen,
} from "lucide-react";

// ---------- shared types ----------

type InputMode = "url" | "text" | "youtube";

interface SessionSummary {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PageRec {
  id: string;
  sessionId: string;
  url: string | null;
  title: string;
  content: string;
  summary: string | null;
  summaryLength: string;
  sourceType: string;
  createdAt: string;
}

interface Citation {
  n: number;
  chunkId: string;
  pageId: string;
  pageTitle: string;
  ordinal: number;
  heading: string;
  preview: string;
}

interface ChatMessageRec {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  citations: string | null;
  createdAt: string;
}

interface HighlightRec {
  id: string;
  text: string;
  note: string | null;
  pageId: string | null;
  page: { id: string; title: string; url: string | null } | null;
  createdAt: string;
}

interface SessionDetail {
  id: string;
  name: string | null;
  pages: PageRec[];
  messages: ChatMessageRec[];
  highlights: HighlightRec[];
}

interface Stats {
  sessions: number;
  pages: number;
  messages: number;
  highlights: number;
}

const LENGTH_LABELS: Record<number, string> = {
  1: "Brief",
  2: "Medium",
  3: "Detailed",
};

const LENGTH_BLURB: Record<number, string> = {
  1: "3 bullets",
  2: "1 paragraph + 5 bullets",
  3: "3 paragraphs + key quotes",
};

const SOURCE_ICON: Record<string, typeof FileText> = {
  url: LinkIcon,
  text: Type,
  youtube: Youtube,
};

const CITATION_SEPARATOR = "\n---CITATIONS---\n";

// ---------- helpers ----------

function parseCitations(s: string | null): Citation[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}

function MessageContent({
  content,
  citations,
}: {
  content: string;
  citations: Citation[];
}) {
  if (!citations || citations.length === 0) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>;
  }
  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts: React.ReactNode[] = [];
  const re = /\[\^(c\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content)) !== null) {
    parts.push(content.slice(last, m.index));
    const n = parseInt(m[1].slice(1), 10);
    const cite = byN.get(n);
    if (cite) {
      parts.push(
        <sup
          key={`c${key++}`}
          className="text-primary font-semibold ml-0.5 cursor-help"
          title={`${cite.pageTitle} (chunk ${cite.ordinal})`}
        >
          [{n}]
        </sup>,
      );
    } else {
      parts.push(
        <sup key={`c${key++}`} className="text-muted-foreground ml-0.5">
          [{n}]
        </sup>,
      );
    }
    last = m.index + m[0].length;
  }
  parts.push(content.slice(last));
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{parts}</div>;
}

// ---------- main page ----------

export default function Page() {
  const { toast } = useToast();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [stats, setStats] = useState<Stats>({ sessions: 0, pages: 0, messages: 0, highlights: 0 });

  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [inputValue, setInputValue] = useState("");
  const [summaryLength, setSummaryLength] = useState<number>(2);
  const [summarizing, setSummarizing] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const [highlightText, setHighlightText] = useState("");
  const [highlightNote, setHighlightNote] = useState("");
  const [highlightPageId, setHighlightPageId] = useState<string>("");
  const [addingHighlight, setAddingHighlight] = useState(false);

  const [expandedPageId, setExpandedPageId] = useState<string | null>(null);

  // ---------- data loading ----------

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as SessionSummary[];
    setSessions(data);
    return data;
  }, []);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/stats");
    if (!res.ok) return;
    setStats((await res.json()) as Stats);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    setSession((await res.json()) as SessionDetail);
  }, []);

  // On mount: load sessions + stats. If no sessions, create one.
  useEffect(() => {
    (async () => {
      const data = await loadSessions();
      await loadStats();
      if (data && data.length > 0) {
        setCurrentSessionId(data[0].id);
      } else {
        // create a first session
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Session 1" }),
        });
        if (res.ok) {
          const created = (await res.json()) as SessionSummary;
          setSessions([created]);
          setCurrentSessionId(created.id);
          await loadStats();
        }
      }
    })().catch((e) => {
      console.warn("init failed", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever currentSessionId changes, load the session detail.
  useEffect(() => {
    if (currentSessionId) {
      loadSession(currentSessionId).catch((e) => console.warn("loadSession failed", e));
    } else {
      setSession(null);
    }
  }, [currentSessionId, loadSession]);

  // Auto-scroll the chat panel to the bottom on new messages / streaming.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [session?.messages, streamingMessage]);

  // ---------- session picker ----------

  const onPickSession = useCallback(
    async (value: string) => {
      if (value === "__new__") {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `Session ${sessions.length + 1}` }),
        });
        if (!res.ok) {
          toast({ title: "Failed to create session", variant: "destructive" });
          return;
        }
        const created = (await res.json()) as SessionSummary;
        setSessions((prev) => [created, ...prev]);
        setCurrentSessionId(created.id);
        await loadStats();
        toast({ title: "New session created" });
      } else {
        setCurrentSessionId(value);
      }
    },
    [sessions.length, toast, loadStats],
  );

  const onDeleteSession = useCallback(async () => {
    if (!currentSessionId) return;
    if (!confirm("Delete this session and all its pages, messages, and highlights?")) return;
    const res = await fetch(`/api/sessions/${currentSessionId}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Delete failed", variant: "destructive" });
      return;
    }
    const remaining = sessions.filter((s) => s.id !== currentSessionId);
    setSessions(remaining);
    if (remaining.length > 0) {
      setCurrentSessionId(remaining[0].id);
    } else {
      // recreate a fresh session
      const cr = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Session 1" }),
      });
      if (cr.ok) {
        const created = (await cr.json()) as SessionSummary;
        setSessions([created]);
        setCurrentSessionId(created.id);
      } else {
        setCurrentSessionId(null);
      }
    }
    await loadStats();
    toast({ title: "Session deleted" });
  }, [currentSessionId, sessions, toast, loadStats]);

  // ---------- summarize ----------

  const onSummarize = useCallback(async () => {
    if (!currentSessionId) {
      toast({ title: "Create or pick a session first", variant: "destructive" });
      return;
    }
    const trimmed = inputValue.trim();
    if (!trimmed) {
      toast({ title: "Enter a URL, text, or YouTube link", variant: "destructive" });
      return;
    }
    setSummarizing(true);
    try {
      const body: Record<string, unknown> = { summaryLength: LENGTH_LABELS[summaryLength] };
      if (inputMode === "url") body.url = trimmed;
      else if (inputMode === "youtube") body.youtubeUrl = trimmed;
      else body.text = trimmed;

      const res = await fetch(`/api/sessions/${currentSessionId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Summarize failed",
          description: err?.error ?? res.statusText,
          variant: "destructive",
        });
        return;
      }
      const page = (await res.json()) as PageRec;
      setSession((prev) =>
        prev ? { ...prev, pages: [page, ...prev.pages] } : prev,
      );
      setInputValue("");
      await loadStats();
      toast({ title: "Summary ready", description: page.title.slice(0, 60) });
    } catch (e) {
      toast({ title: "Summarize error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSummarizing(false);
    }
  }, [currentSessionId, inputValue, inputMode, summaryLength, toast, loadStats]);

  // ---------- delete page ----------

  const onDeletePage = useCallback(
    async (pageId: string) => {
      if (!currentSessionId) return;
      const res = await fetch(`/api/pages/${pageId}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Delete page failed", variant: "destructive" });
        return;
      }
      setSession((prev) =>
        prev ? { ...prev, pages: prev.pages.filter((p) => p.id !== pageId) } : prev,
      );
      await loadStats();
      toast({ title: "Page removed" });
    },
    [currentSessionId, toast, loadStats],
  );

  // ---------- chat (streaming) ----------

  const onSendChat = useCallback(async () => {
    if (!currentSessionId) return;
    const trimmed = chatInput.trim();
    if (!trimmed || streaming) return;
    setChatInput("");
    setStreaming(true);
    setStreamingMessage("");
    setStreamingCitations([]);

    // optimistic user message
    const userMsg: ChatMessageRec = {
      id: `pending-${Date.now()}`,
      sessionId: currentSessionId,
      role: "user",
      content: trimmed,
      citations: null,
      createdAt: new Date().toISOString(),
    };
    setSession((prev) =>
      prev ? { ...prev, messages: [...prev.messages, userMsg] } : prev,
    );

    try {
      const res = await fetch(`/api/sessions/${currentSessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Chat failed",
          description: err?.error ?? res.statusText,
          variant: "destructive",
        });
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawBuffer += decoder.decode(value, { stream: true });
        const idx = rawBuffer.indexOf(CITATION_SEPARATOR);
        if (idx >= 0) {
          setStreamingMessage(rawBuffer.slice(0, idx));
        } else {
          const safeEnd = Math.max(0, rawBuffer.length - (CITATION_SEPARATOR.length - 1));
          setStreamingMessage(rawBuffer.slice(0, safeEnd));
        }
      }
      const idx = rawBuffer.indexOf(CITATION_SEPARATOR);
      let messageText: string;
      let citationsRaw = "";
      if (idx >= 0) {
        messageText = rawBuffer.slice(0, idx);
        citationsRaw = rawBuffer.slice(idx + CITATION_SEPARATOR.length);
      } else {
        messageText = rawBuffer;
      }
      let citations: Citation[] = [];
      if (citationsRaw) {
        try {
          const parsed = JSON.parse(citationsRaw);
          if (Array.isArray(parsed?.citations)) citations = parsed.citations;
        } catch {
          /* ignore */
        }
      }
      setStreamingMessage(messageText);
      setStreamingCitations(citations);

      const assistantMsg: ChatMessageRec = {
        id: `pending-a-${Date.now()}`,
        sessionId: currentSessionId,
        role: "assistant",
        content: messageText,
        citations: JSON.stringify(citations),
        createdAt: new Date().toISOString(),
      };
      setSession((prev) =>
        prev ? { ...prev, messages: [...prev.messages, assistantMsg] } : prev,
      );
      await loadStats();
    } catch (e) {
      toast({ title: "Chat error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStreaming(false);
      setStreamingMessage("");
      setStreamingCitations([]);
    }
  }, [currentSessionId, chatInput, streaming, toast, loadStats]);

  // ---------- highlights ----------

  const onAddHighlight = useCallback(async () => {
    if (!currentSessionId) return;
    const trimmed = highlightText.trim();
    if (!trimmed) {
      toast({ title: "Enter some text to highlight", variant: "destructive" });
      return;
    }
    setAddingHighlight(true);
    try {
      const body: Record<string, unknown> = { text: trimmed };
      if (highlightNote.trim()) body.note = highlightNote.trim();
      if (highlightPageId) body.pageId = highlightPageId;
      const res = await fetch(`/api/sessions/${currentSessionId}/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast({ title: "Save highlight failed", variant: "destructive" });
        return;
      }
      const hl = (await res.json()) as HighlightRec;
      setSession((prev) =>
        prev ? { ...prev, highlights: [hl, ...prev.highlights] } : prev,
      );
      setHighlightText("");
      setHighlightNote("");
      await loadStats();
      toast({ title: "Highlight saved" });
    } finally {
      setAddingHighlight(false);
    }
  }, [currentSessionId, highlightText, highlightNote, highlightPageId, toast, loadStats]);

  const onDeleteHighlight = useCallback(
    async (hlId: string) => {
      const res = await fetch(`/api/highlights/${hlId}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Delete highlight failed", variant: "destructive" });
        return;
      }
      setSession((prev) =>
        prev ? { ...prev, highlights: prev.highlights.filter((h) => h.id !== hlId) } : prev,
      );
      await loadStats();
    },
    [toast, loadStats],
  );

  // ---------- render ----------

  const pageList = session?.pages ?? [];
  const messageList = session?.messages ?? [];
  const highlightList = session?.highlights ?? [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-2">
            <BookOpen className="size-5 text-primary" />
            <span className="font-semibold text-lg">Doc Summarizer</span>
          </div>
          <Select value={currentSessionId ?? ""} onValueChange={onPickSession}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Pick a session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">+ New session</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name ?? s.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentSessionId && (
            <Button variant="ghost" size="sm" onClick={onDeleteSession}>
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Delete session</span>
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Layers className="size-3" /> {stats.sessions} sessions
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Files className="size-3" /> {stats.pages} pages
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <MessageSquare className="size-3" /> {stats.messages} msgs
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Highlighter className="size-3" /> {stats.highlights} highlights
            </Badge>
          </div>
        </div>
      </header>

      {/* Main 2-column layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {/* LEFT column */}
        <section className="flex flex-col gap-4 min-w-0">
          {/* Input card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" /> Summarize a page
              </CardTitle>
              <CardDescription>
                Paste a URL, paste text, or drop a YouTube link. Pick a depth, then summarize.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RadioGroup
                className="grid grid-cols-3 gap-2"
                value={inputMode}
                onValueChange={(v) => setInputMode(v as InputMode)}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="url" id="m-url" />
                  <Label htmlFor="m-url" className="flex items-center gap-1 cursor-pointer">
                    <LinkIcon className="size-3" /> URL
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="text" id="m-text" />
                  <Label htmlFor="m-text" className="flex items-center gap-1 cursor-pointer">
                    <Type className="size-3" /> Text
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="youtube" id="m-yt" />
                  <Label htmlFor="m-yt" className="flex items-center gap-1 cursor-pointer">
                    <Youtube className="size-3" /> YouTube
                  </Label>
                </div>
              </RadioGroup>

              {inputMode === "text" ? (
                <Textarea
                  placeholder="Paste the full text you want summarized…"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="min-h-32"
                />
              ) : (
                <Input
                  placeholder={
                    inputMode === "url"
                      ? "https://example.com/article"
                      : "https://youtube.com/watch?v=…"
                  }
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSummarize();
                  }}
                />
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <Label className="flex items-center gap-1">
                    <Layers className="size-3" /> Summary length
                  </Label>
                  <Badge variant="outline">
                    {LENGTH_LABELS[summaryLength]} · {LENGTH_BLURB[summaryLength]}
                  </Badge>
                </div>
                <Slider
                  min={1}
                  max={3}
                  step={1}
                  value={[summaryLength]}
                  onValueChange={(v) => setSummaryLength(v[0] ?? 2)}
                />
                <div className="flex justify-between text-xs text-muted-foreground px-1">
                  <span>Brief</span>
                  <span>Medium</span>
                  <span>Detailed</span>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={onSummarize} disabled={summarizing || !currentSessionId} className="w-full">
                {summarizing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Summarizing…
                  </>
                ) : (
                  <>
                    <FileText className="size-4" /> Summarize
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Pages list */}
          <Card className="flex-1 min-h-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Files className="size-4" /> Pages in this session
                <Badge variant="secondary" className="ml-auto">{pageList.length}</Badge>
              </CardTitle>
              <CardDescription>
                Each page is summarised once. The follow-up chat can reference any of them.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0">
              {pageList.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No pages yet. Summarize one above.
                </p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto scrollbar-thin pr-1 flex flex-col gap-3">
                  {pageList.map((p) => {
                    const Icon = SOURCE_ICON[p.sourceType] ?? FileText;
                    const expanded = expandedPageId === p.id;
                    return (
                      <div key={p.id} className="rounded-lg border p-3 flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{p.title}</div>
                            {p.url && (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-muted-foreground hover:text-primary truncate block"
                              >
                                {p.url}
                              </a>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {p.summaryLength}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => onDeletePage(p.id)}
                            title="Delete page"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                        {p.summary && (
                          <div className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted/40 rounded-md p-2 max-h-40 overflow-y-auto scrollbar-thin">
                            {p.summary}
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start h-7 text-xs"
                          onClick={() => setExpandedPageId(expanded ? null : p.id)}
                        >
                          {expanded ? "Hide original" : "Show original"}
                        </Button>
                        {expanded && (
                          <Tabs defaultValue="content">
                            <TabsList>
                              <TabsTrigger value="content">Original</TabsTrigger>
                              <TabsTrigger value="summary">Summary</TabsTrigger>
                            </TabsList>
                            <TabsContent value="content">
                              <div className="whitespace-pre-wrap text-xs max-h-64 overflow-y-auto scrollbar-thin p-2 rounded-md bg-muted/30">
                                {p.content}
                              </div>
                            </TabsContent>
                            <TabsContent value="summary">
                              <div className="whitespace-pre-wrap text-xs max-h-64 overflow-y-auto scrollbar-thin p-2 rounded-md bg-muted/30">
                                {p.summary ?? "(no summary)"}
                              </div>
                            </TabsContent>
                          </Tabs>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* RIGHT column */}
        <section className="flex flex-col gap-4 min-w-0">
          {/* Chat card */}
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4" /> Follow-up Q&amp;A
              </CardTitle>
              <CardDescription>
                Ask anything about the summarised pages. Replies are grounded via hybrid RAG with inline citations.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              <div
                ref={chatScrollRef}
                className="flex-1 min-h-0 max-h-[26rem] overflow-y-auto scrollbar-thin pr-1 flex flex-col gap-3"
              >
                {messageList.length === 0 && !streaming && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Ask a follow-up question to see a grounded, cited answer.
                  </p>
                )}
                {messageList.map((m) => {
                  const cits = parseCitations(m.citations);
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg p-3 ${
                          isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                        ) : (
                          <>
                            <MessageContent content={m.content} citations={cits} />
                            {cits.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1 pt-2 border-t border-border/40">
                                {cits.map((c) => (
                                  <Badge
                                    key={c.chunkId}
                                    variant="secondary"
                                    className="text-[10px] gap-1"
                                    title={c.preview}
                                  >
                                    [{c.n}] {c.pageTitle} #{c.ordinal}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg p-3 bg-muted">
                      <div className="whitespace-pre-wrap text-sm">
                        {streamingMessage || (
                          <span className="text-muted-foreground italic">…</span>
                        )}
                      </div>
                      {streamingCitations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 pt-2 border-t border-border/40">
                          {streamingCitations.map((c) => (
                            <Badge key={c.chunkId} variant="secondary" className="text-[10px] gap-1">
                              [{c.n}] {c.pageTitle} #{c.ordinal}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Textarea
                placeholder="Ask a follow-up question…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendChat();
                  }
                }}
                className="min-h-10 resize-none"
                disabled={streaming}
              />
              <Button onClick={onSendChat} disabled={streaming || !chatInput.trim() || !currentSessionId} size="icon">
                {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </CardFooter>
          </Card>

          {/* Highlights card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Highlighter className="size-4" /> Saved highlights
                <Badge variant="secondary" className="ml-auto">{highlightList.length}</Badge>
              </CardTitle>
              <CardDescription>
                Save a quote or note. Optionally attach it to a page in this session.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Textarea
                  placeholder="Highlight text…"
                  value={highlightText}
                  onChange={(e) => setHighlightText(e.target.value)}
                  className="min-h-12"
                />
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-2">
                  <Input
                    placeholder="Note (optional)"
                    value={highlightNote}
                    onChange={(e) => setHighlightNote(e.target.value)}
                  />
                  <Select
                    value={highlightPageId}
                    onValueChange={setHighlightPageId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Attach to page (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="(none)">(no page)</SelectItem>
                      {pageList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title.slice(0, 40)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={onAddHighlight} disabled={addingHighlight} size="sm" className="self-start">
                  {addingHighlight ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Save highlight
                </Button>
              </div>
              <Separator />
              {highlightList.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 text-center">
                  No highlights yet.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto scrollbar-thin pr-1 flex flex-col gap-2">
                  {highlightList.map((h) => (
                    <div key={h.id} className="rounded-md border p-2 flex flex-col gap-1">
                      <div className="text-sm whitespace-pre-wrap">{h.text}</div>
                      {h.note && (
                        <div className="text-xs text-muted-foreground italic">— {h.note}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {h.page && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Files className="size-2.5" />
                            {h.page.title.slice(0, 30)}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 ml-auto"
                          onClick={() => onDeleteHighlight(h.id)}
                          title="Delete highlight"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t">
        <div className="px-4 py-3 text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
          <span>Doc Summarizer — MVP web app (Plasmo sidebar extension is a stretch goal).</span>
          <span>MIT License · Next.js 16 · z-ai-web-dev-sdk · Prisma + SQLite</span>
        </div>
      </footer>
    </div>
  );
}
