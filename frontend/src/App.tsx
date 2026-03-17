import { useEffect, useState } from "react";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { Bars3Icon, BellIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ChartPanel } from "./ChartPanel";
import { SymbolStreamsPanel } from "./SymbolStreamsPanel";
import { LiveMonitorPanel } from "./LiveMonitorPanel";
import { ReportPanel } from "./ReportPanel";
import { AssetsPanel } from "./AssetsPanel";
import { addStream, setPrimarySymbol as setPrimarySymbolOnServer } from "./lib/api";
import type { SessionInfo } from "./types";

const user = {
  name: "Tom Cook",
  email: "tom@example.com",
  imageUrl:
    "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
};

type AppTab = "trade" | "report" | "assets";

const tabs: { id: AppTab; name: string }[] = [
  { id: "trade", name: "Trade" },
  { id: "report", name: "Report" },
  { id: "assets", name: "Assets" }
];

const userNavigation = [
  { name: "Your profile", href: "#" },
  { name: "Settings", href: "#" },
  { name: "Sign out", href: "#" },
];

function classNames(...classes: Array<string | boolean | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTC");
  const [primarySymbol, setPrimarySymbol] = useState<string>("BTC");
  const [snapshotMode, setSnapshotMode] = useState<"preopen" | "live">("preopen");
  const [activeTab, setActiveTab] = useState<AppTab>("trade");
  const [subscribedAssets, setSubscribedAssets] = useState<string[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [historyPreloading, setHistoryPreloading] = useState(false);
  const [clockNowMs, setClockNowMs] = useState<number>(() => Date.now());
  const [restartSignal, setRestartSignal] = useState(0);

  const sessionElapsedMs = sessionInfo ? clockNowMs - sessionInfo.startedAtMs : 0;

  const handleChangeTab = (tab: AppTab) => {
    setActiveTab(tab);
  };

  const handleSubscribeAsset = async (asset: string) => {
    const symbol = asset.toUpperCase();
    setSelectedSymbol(symbol);
    setPrimarySymbol(symbol);

    await addStream(symbol);
    await setPrimarySymbolOnServer(symbol);
  };

  const handleStreamsChange = (symbols: string[], primary: string) => {
    setSubscribedAssets(symbols);
    setPrimarySymbol(primary);
  };

  const handleSelectAssetForChart = async (asset: string) => {
    const symbol = asset.toUpperCase();
    setSelectedSymbol(symbol);
    setPrimarySymbol(symbol);
    await setPrimarySymbolOnServer(symbol);
  };

  const handleAssetsPanelSelect = async (asset: string) => {
    await handleSelectAssetForChart(asset);
    setActiveTab("trade");
  };

  const handleShuffleDirection = (direction: "prev" | "next") => {
    if (subscribedAssets.length === 0) return;
    const upperAssets = subscribedAssets.map((s) => s.toUpperCase());
    const current = primarySymbol.toUpperCase();
    const currentIndex = upperAssets.indexOf(current);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      direction === "next"
        ? (safeIndex + 1) % upperAssets.length
        : (safeIndex - 1 + upperAssets.length) % upperAssets.length;
    const nextSymbol = upperAssets[nextIndex];
    void handleSelectAssetForChart(nextSymbol);
  };

  const handleSessionInfoChange = (nextSessionInfo: SessionInfo) => {
    setSessionInfo(nextSessionInfo);
  };

  const handleRestartSession = () => {
    setRestartSignal((prev) => prev + 1);
  };

  useEffect(() => {
    const id = setInterval(() => setClockNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-full">
      <Disclosure as="nav" className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
              <div className="flex">
                <div className="flex shrink-0 items-center">
                  <img
                    alt="Your Company"
                    src="https://tailwindcss.com/plus-assets/img/logos/mark.svg?color=indigo&shade=600"
                    className="h-8 w-auto"
                  />
                </div>
                <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleChangeTab(tab.id)}
                      className={classNames(
                        activeTab === tab.id
                          ? "border-indigo-600 text-gray-900"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
                        "inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium"
                      )}
                      aria-current={activeTab === tab.id ? "page" : undefined}
                    >
                      {tab.name}
                    </button>
                  ))}
                </div>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:items-center">
              {sessionInfo && (
                <div className="mr-3 inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${
                      sessionInfo.status === "active" ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  <span className="uppercase tracking-wide">{sessionInfo.status}</span>
                  <span className="text-gray-400">|</span>
                  <span>S:{sessionInfo.id.slice(-6)}</span>
                  <span className="text-gray-400">|</span>
                  <span>{formatElapsed(sessionElapsedMs)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleRestartSession}
                disabled={historyPreloading}
                className="mr-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {historyPreloading ? "Reloading history..." : "Restart Session"}
              </button>
            </div>
            <div className="-mr-2 flex items-center sm:hidden">
              {/* Mobile menu button */}
              <DisclosureButton className="group relative inline-flex items-center justify-center rounded-md bg-white p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600">
                <span className="absolute -inset-0.5" />
                <span className="sr-only">Open main menu</span>
                <Bars3Icon aria-hidden="true" className="block size-6 group-data-open:hidden" />
                <XMarkIcon aria-hidden="true" className="hidden size-6 group-data-open:block" />
              </DisclosureButton>
            </div>
          </div>
        </div>

        <DisclosurePanel className="sm:hidden">
          <div className="space-y-1 pt-2 pb-3">
            {tabs.map((tab) => (
              <DisclosureButton
                key={tab.id}
                as="button"
                type="button"
                onClick={() => handleChangeTab(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={classNames(
                  activeTab === tab.id
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800",
                  "block w-full border-l-4 py-2 pr-4 pl-3 text-left text-base font-medium"
                )}
              >
                {tab.name}
              </DisclosureButton>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-4 pb-3">
            <div className="flex items-center px-4">
              <div className="shrink-0">
                <img
                  alt=""
                  src={user.imageUrl}
                  className="size-10 rounded-full outline -outline-offset-1 outline-black/5"
                />
              </div>
              <div className="ml-3">
                <div className="text-base font-medium text-gray-800">{user.name}</div>
                <div className="text-sm font-medium text-gray-500">{user.email}</div>
              </div>
              <button
                type="button"
                className="relative ml-auto shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-500 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
              >
                <span className="absolute -inset-1.5" />
                <span className="sr-only">View notifications</span>
                <BellIcon aria-hidden="true" className="size-6" />
              </button>
            </div>
            <div className="mt-3 space-y-1">
              {userNavigation.map((item) => (
                <DisclosureButton
                  key={item.name}
                  as="a"
                  href={item.href}
                  className="block px-4 py-2 text-base font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                >
                  {item.name}
                </DisclosureButton>
              ))}
            </div>
          </div>
        </DisclosurePanel>
      </Disclosure>

      <div className="py-10">
        <header>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {activeTab === "trade" && "Trade"}
              {activeTab === "report" && "RVOL Report"}
              {activeTab === "assets" && "Assets"}
            </h1>
          </div>
        </header>
        <main>
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {activeTab === "trade" && (
              <div className="space-y-6">
                <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <SymbolStreamsPanel
                    selectedSymbol={selectedSymbol}
                    onSelectedChange={setSelectedSymbol}
                    onPrimaryChange={setPrimarySymbol}
                    onStreamsChange={handleStreamsChange}
                  />
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold tracking-tight text-gray-900">
                        {primarySymbol}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                        Primary
                      </span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                      <button
                        type="button"
                        className="rounded-full px-2 py-0.5 hover:bg-gray-100"
                        onClick={() => handleShuffleDirection("prev")}
                        disabled={subscribedAssets.length === 0}
                      >
                        ◀
                      </button>
                      <span className="px-1">
                        {subscribedAssets.length > 0
                          ? `${subscribedAssets.indexOf(primarySymbol) + 1} / ${
                              subscribedAssets.length
                            }`
                          : "No subscribed assets"}
                      </span>
                      <button
                        type="button"
                        className="rounded-full px-2 py-0.5 hover:bg-gray-100"
                        onClick={() => handleShuffleDirection("next")}
                        disabled={subscribedAssets.length === 0}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                  <ChartPanel
                    symbol={primarySymbol}
                    trackedSymbols={[...subscribedAssets, primarySymbol]}
                    restartSignal={restartSignal}
                    onSessionInfoChange={handleSessionInfoChange}
                    onHistoryPreloadingChange={setHistoryPreloading}
                  />
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <LiveMonitorPanel onSubscribeAsset={handleSubscribeAsset} />
                </section>

              </div>
            )}

            {activeTab === "report" && (
              <div className="grid gap-6">
                <ReportPanel snapshotMode={snapshotMode} />
              </div>
            )}

            {activeTab === "assets" && (
              <div className="grid gap-6">
                <AssetsPanel snapshotMode={snapshotMode} onSelectAsset={handleAssetsPanelSelect} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
