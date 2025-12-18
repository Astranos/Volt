import React, { useState, useEffect } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Layers, Search, Copy, Check, Clock, X } from "lucide-react";
import { Skeleton } from "../ui/skeleton";

interface EbaySuggestion {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
}

export default function EbayTaxonomyTool() {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<EbaySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("ebay_taxonomy_recent_queries");
    if (saved) {
      try {
        setRecentQueries(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse recent queries", e);
      }
    }
  }, []);

  const addToHistory = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return;
    setRecentQueries((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, 10);
      localStorage.setItem(
        "ebay_taxonomy_recent_queries",
        JSON.stringify(next)
      );
      return next;
    });
  };

  const clearHistory = () => {
    setRecentQueries([]);
    localStorage.removeItem("ebay_taxonomy_recent_queries");
  };

  useEffect(() => {
    const fetchSuggestions = async () => {
      const q = search.trim();
      if (q.length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `https://paymore-extension.vercel.app/api/ebay-categories?q=${encodeURIComponent(
            q
          )}`
        );
        const data = await res.json().catch(() => ({}));
        // The CMDK version sliced to 1, but in sidepanel we might want more?
        // "we have it built into the command menu pop" - implying functionality is similar.
        // CMDK usually shows limited results. Let's show more here since it's a dedicated tool.
        const results = data.suggestions || [];
        setSuggestions(results);
        if (results.length > 0) {
          addToHistory(q);
        }
      } catch (err) {
        console.error("Failed to fetch eBay suggestions:", err);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    const t = setTimeout(fetchSuggestions, 250);
    return () => clearTimeout(t);
  }, [search]);

  const copyCategory = async (categoryPath: string, categoryId: string) => {
    try {
      await navigator.clipboard.writeText(categoryPath);
      setCopiedId(categoryId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error("Failed to copy eBay category:", err);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search eBay categories..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-border">
                <CardContent className="p-3 flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && search.length < 2 && recentQueries.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1 mb-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Recent Searches
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                onClick={clearHistory}
              >
                Clear All
              </Button>
            </div>
            {recentQueries.map((q) => (
              <div
                key={q}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer group transition-colors"
                onClick={() => setSearch(q)}
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm flex-1 truncate">{q}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && suggestions.length === 0 && search.length >= 2 && (
          <div className="text-center py-8 text-muted-foreground">
            <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No categories found</p>
          </div>
        )}

        {!loading && suggestions.length > 0 && (
          <div className="space-y-2">
            {suggestions.map((s) => (
              <Card
                key={s.categoryId}
                className="border-border hover:bg-accent/50 transition-colors cursor-pointer group"
                onClick={() => copyCategory(s.categoryPath, s.categoryId)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded bg-green-100 text-green-600">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {s.categoryName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.categoryPath}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedId === s.categoryId ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
