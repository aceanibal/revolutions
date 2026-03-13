import { useState } from "react";
import { ChartPanel } from "./ChartPanel";
import { SymbolStreamsPanel } from "./SymbolStreamsPanel";

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTC");
  const [primarySymbol, setPrimarySymbol] = useState<string>("BTC");

  return (
    <div className="dashboard">
      <SymbolStreamsPanel
        selectedSymbol={selectedSymbol}
        onSelectedChange={setSelectedSymbol}
        onPrimaryChange={setPrimarySymbol}
      />

      <ChartPanel key={primarySymbol} symbol={primarySymbol} />

      <section className="controller panel">
        <h2>PS5 Button State</h2>
        <div className="controller-grid">
          <div className="dpad">
            <div className="btn dpad-btn up">U</div>
            <div className="btn dpad-btn left">L</div>
            <div className="btn dpad-btn down">D</div>
            <div className="btn dpad-btn right">R</div>
          </div>
          <div className="face-buttons">
            <div className="btn face triangle">Triangle</div>
            <div className="btn face circle">Circle</div>
            <div className="btn face cross">Cross</div>
            <div className="btn face square">Square</div>
          </div>
        </div>
      </section>
    </div>
  );
}
