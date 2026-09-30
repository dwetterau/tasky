"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Navigation } from "../../components/Navigation";
import { SignIn } from "../../components/SignIn";
import { useAuthSession } from "@/lib/useAuthSession";
import { useTrackedMutation } from "@/lib/useTrackedMutation";

type ApiKeyType =
  | "github"
  | "linear"
  | "cursor_agent_sdk"
  | "accuweather"
  | "portfolio_airtable_api_key"
  | "portfolio_airtable_base_id";

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function getApiKeyTypeLabel(type: string): string {
  switch (type) {
    case "github":
      return "GitHub";
    case "linear":
      return "Linear";
    case "cursor_agent_sdk":
      return "Cursor Agent SDK";
    case "accuweather":
      return "AccuWeather (personal homepage)";
    case "portfolio_airtable_api_key":
      return "Portfolio Airtable API Key";
    case "portfolio_airtable_base_id":
      return "Portfolio Airtable Base ID";
    default:
      return "Legacy configuration";
  }
}

function SettingsContent() {
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const convexSubdomain = (() => {
    if (!convexSiteUrl) return "<your-project>";
    try {
      return new URL(convexSiteUrl).hostname.split(".")[0] || "<your-project>";
    } catch {
      return "<your-project>";
    }
  })();
  const mcpConfig = `{
  "mcpServers": {
    "tasky": {
      "url": "https://${convexSubdomain}.convex.site/api/mcp"
    }
  }
}`;
  const keys = useQuery(api.apiKeys.list, {});
  const portfolios = useQuery(api.portfolios.list, {});
  const [name, setName] = useState("");
  const [type, setType] = useState<ApiKeyType>("github");
  const [value, setValue] = useState("");
  const [portfolioName, setPortfolioName] = useState("");
  const [portfolioViewId, setPortfolioViewId] = useState("");
  const [portfolioStartDate, setPortfolioStartDate] = useState("");
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const namePlaceholder =
    type === "github"
      ? "Production GitHub token"
      : type === "linear"
        ? "Production Linear API key"
        : type === "cursor_agent_sdk"
          ? "Production Cursor Agent SDK key"
          : getApiKeyTypeLabel(type);

  const create = useTrackedMutation(api.apiKeys.create).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.apiKeys.list, {});
      if (current === undefined) return;
      const tempKey = {
        _id: crypto.randomUUID() as Id<"apiKeys">,
        _creationTime: Number.MAX_SAFE_INTEGER,
        userId: "",
        name: args.name,
        type: args.type,
        keyVersion: 1,
        updatedAt: 0,
      };
      localStore.setQuery(api.apiKeys.list, {}, [tempKey, ...current]);
    },
  );

  const remove = useTrackedMutation(api.apiKeys.remove).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.apiKeys.list, {});
      if (current === undefined) return;
      localStore.setQuery(
        api.apiKeys.list,
        {},
        current.filter((key) => key._id !== args.id),
      );
    },
  );
  const createPortfolio = useTrackedMutation(api.portfolios.create);
  const removePortfolio = useTrackedMutation(api.portfolios.remove);
  const setDefaultPortfolio = useTrackedMutation(api.portfolios.setDefault);

  const canCreate = name.trim() && value.trim();

  const handleCreate = () => {
    if (!canCreate) return;
    create({
      name: name.trim(),
      type,
      value: value.trim(),
    });
    setValue("");
  };

  const handleCreatePortfolio = async () => {
    if (
      !portfolioName.trim() ||
      !portfolioViewId.trim() ||
      !portfolioStartDate.trim()
    ) {
      return;
    }
    setPortfolioError(null);
    try {
      await createPortfolio({
        name: portfolioName.trim(),
        airtableViewId: portfolioViewId.trim(),
        startDate: portfolioStartDate.trim(),
      });
      setPortfolioName("");
      setPortfolioViewId("");
      setPortfolioStartDate("");
    } catch (createError) {
      setPortfolioError(
        createError instanceof Error
          ? createError.message
          : "Failed to create portfolio",
      );
    }
  };

  return (
    <div className="min-h-screen pt-20 pb-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-2">Settings</h1>
          <p className="text-sm text-(--muted)">
            Manage user-scoped API keys used by integrations. Keys are encrypted
            at rest and never shown again after saving.
          </p>
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5 mb-6">
          <h2 className="text-base font-medium mb-2">Portfolios</h2>
          <p className="text-sm text-(--muted) mb-4">
            Each portfolio maps to one Airtable Positions view. Price syncs
            update every configured portfolio together and reuse market prices
            for shared tickers.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">
                Name
              </label>
              <input
                type="text"
                value={portfolioName}
                onChange={(event) => setPortfolioName(event.target.value)}
                placeholder="Vanguard Brokerage"
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">
                Airtable View ID
              </label>
              <input
                type="text"
                value={portfolioViewId}
                onChange={(event) => setPortfolioViewId(event.target.value)}
                placeholder="viw..."
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">
                History Start Date
              </label>
              <input
                type="date"
                value={portfolioStartDate}
                onChange={(event) => setPortfolioStartDate(event.target.value)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end mb-4">
            <button
              type="button"
              onClick={() => void handleCreatePortfolio()}
              disabled={
                !portfolioName.trim() ||
                !portfolioViewId.trim() ||
                !portfolioStartDate.trim()
              }
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Portfolio
            </button>
          </div>
          {portfolioError ? (
            <p className="text-sm text-red-400 mb-3">{portfolioError}</p>
          ) : null}
          {portfolios === undefined ? (
            <p className="text-sm text-(--muted)">Loading...</p>
          ) : portfolios.length === 0 ? (
            <p className="text-sm text-(--muted)">
              No portfolios configured yet.
            </p>
          ) : (
            <div className="space-y-2">
              {portfolios.map((portfolio) => (
                <div
                  key={portfolio._id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-(--card-border) px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {portfolio.name}
                      {portfolio.isDefault ? (
                        <span className="ml-2 text-xs text-accent">Default</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-(--muted) truncate">
                      {portfolio.airtableViewId} · history from{" "}
                      {portfolio.startDate}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!portfolio.isDefault ? (
                      <button
                        type="button"
                        onClick={() =>
                          void setDefaultPortfolio({ id: portfolio._id })
                        }
                        className="text-xs text-accent hover:underline"
                      >
                        Make default
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        void removePortfolio({ id: portfolio._id })
                      }
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5 mb-6">
          <h2 className="text-base font-medium mb-4">Add API Key</h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-(--muted) mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ApiKeyType)}
                className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
              >
                <option value="github">GitHub</option>
                <option value="linear">Linear</option>
                <option value="cursor_agent_sdk">Cursor Agent SDK</option>
                <option value="accuweather">AccuWeather (personal homepage)</option>
                <option value="portfolio_airtable_api_key">
                  Portfolio Airtable API Key
                </option>
                <option value="portfolio_airtable_base_id">
                  Portfolio Airtable Base ID
                </option>
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-(--muted) mb-1">
              Key Value
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste API key"
              className="w-full h-[38px] px-3 bg-background border border-(--card-border) rounded-lg focus:outline-none focus:border-accent transition-colors text-sm"
            />
            {type === "github" ? (
              <p className="mt-2 text-xs text-(--muted)">
                Tip: You can use your GitHub CLI token. Run{" "}
                <code>gh auth token</code>, then paste the output here.
              </p>
            ) : type === "linear" ? (
              <p className="mt-2 text-xs text-(--muted)">
                Tip: Create a Personal API Key in{" "}
                <a
                  href="https://linear.app/settings/account/security"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Linear security settings
                </a>
                .
              </p>
            ) : type === "cursor_agent_sdk" ? (
              <p className="mt-2 text-xs text-(--muted)">
                Tip: Create a key in your Cursor dashboard:{" "}
                <a
                  href="https://cursor.com/dashboard?tab=cloud-agents#my-user-api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  cursor.com/dashboard?tab=cloud-agents#my-user-api-keys
                </a>
                .
              </p>
            ) : type.startsWith("portfolio_") ? (
              <p className="mt-2 text-xs text-(--muted)">
                Portfolio values are used server-side by Tasky to read
                Airtable/market data. They are encrypted at rest and are never
                sent to the mobile app. View IDs and history dates are
                configured in the Portfolios section above.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate}
              className="px-4 py-2 text-sm bg-accent hover:bg-(--accent-hover) text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Key
            </button>
          </div>
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5">
          <h2 className="text-base font-medium mb-4">Saved API Keys</h2>
          {keys === undefined ? (
            <p className="text-sm text-(--muted)">Loading...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-(--muted)">No keys saved yet.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div
                  key={key._id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-(--card-border) px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="text-xs text-(--muted)">
                      {getApiKeyTypeLabel(key.type as ApiKeyType)} · saved{" "}
                      {formatTimestamp(key._creationTime)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove({ id: key._id })}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-(--card-bg) border border-(--card-border) rounded-xl p-5 mt-6">
          <h2 className="text-base font-medium mb-2">Cursor MCP Config</h2>
          <p className="text-sm text-(--muted) mb-3">
            Add this to your Cursor MCP config file (typically{" "}
            <code>~/.cursor/mcp.json</code>).
          </p>
          <pre className="overflow-x-auto rounded-lg border border-(--card-border) bg-background p-3 text-xs leading-relaxed">
            <code>{mcpConfig}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { session, isPending } = useAuthSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return (
    <>
      <Navigation />
      <SettingsContent />
    </>
  );
}
