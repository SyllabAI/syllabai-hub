/**
 * KGX styles — the v75 paper aesthetic, scoped under `.kgx` so the explorer
 * can live inside any shadcn surface without leaking. Injected once as a
 * <style id="kgx-styles"> tag by the engine (keeps the module self-contained
 * and dodges global-CSS import constraints for client components).
 */
export const KGX_CSS = `
.kgx{position:relative;width:100%;height:640px;background:radial-gradient(circle at 46% 40%,rgba(255,255,255,.72),transparent 42%),#f7f4ec;color:#273239;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid #d6d0c4;border-radius:10px;overflow:hidden;user-select:none}
.kgx *{box-sizing:border-box}
.kgx-svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.kgx-svg:focus-visible{outline:2px solid rgba(74,155,112,.8);outline-offset:-2px}
.kgx-svg.grabbing{cursor:grabbing}
.kgx .edge{fill:none;vector-effect:non-scaling-stroke;pointer-events:stroke}
.kgx .edge.hier{stroke:#566066;stroke-width:1;opacity:.28}
.kgx .edge.pre{stroke:#4b6f88;stroke-width:1.35;opacity:.62}
.kgx .edge.rel{stroke:#7d8587;stroke-width:1;stroke-dasharray:4 6;opacity:.3}
.kgx .edge.assess{stroke:#b77b21;stroke-width:1.2;opacity:.52}
.kgx .edge.state{stroke:#c85b78;stroke-width:1;stroke-dasharray:2 5;opacity:.48}
.kgx .edge.suggested{stroke-dasharray:3 5;opacity:.34}
.kgx .edge.active{stroke:#263239;stroke-width:2.2;opacity:.95}
.kgx .edge.tracePath{stroke:#6656a9;stroke-width:2.4;stroke-dasharray:6 5;opacity:.9}
.kgx .edge.dim{opacity:.05}
.kgx .node{cursor:pointer}
.kgx .node .body{fill:#fbfaf6;stroke-width:2;vector-effect:non-scaling-stroke;transition:stroke-width .12s}
.kgx .node text{fill:#343d42;pointer-events:none;paint-order:stroke;stroke:#f7f4ec;stroke-width:3.5px;stroke-linejoin:round}
.kgx .node .label{font-size:11px;font-weight:600}
.kgx .node .kind{font-size:8px;fill:#7d8587;font-weight:400}
.kgx .node.dim{opacity:.13}
.kgx .node.selected .body{stroke-width:3.4}
.kgx .node.hovered .body{stroke-width:3}
.kgx .node.pinned .body{stroke-width:3;stroke-dasharray:none}
.kgx .node .halo{fill:none;stroke-width:1.2;opacity:.12;vector-effect:non-scaling-stroke}
.kgx .node.traceHalo .halo{stroke:#6656a9;opacity:.5}
.kgx .stateRing{fill:none;stroke-width:3;vector-effect:non-scaling-stroke;opacity:.9}
.kgx .reviewPulse{fill:none;stroke:#c85b78;stroke-width:1.4;vector-effect:non-scaling-stroke;animation:kgxPulse 2.6s ease-in-out infinite}
@keyframes kgxPulse{0%,100%{opacity:.08;transform:scale(1)}50%{opacity:.45;transform:scale(1.12)}}
.kgx .misconMark{fill:#fbfaf6;stroke:#b85a52;stroke-width:1.6;vector-effect:non-scaling-stroke}
.kgx .attemptsBadge{font-size:8px;fill:#fff;font-weight:700;pointer-events:none}
.kgx .expandBadge{font-size:8px;fill:#fff;font-weight:700;pointer-events:none}
.kgx .pathBadge{font-size:7px;font-weight:700;fill:#fff;stroke:#6656a9;stroke-width:1.5;paint-order:stroke;pointer-events:none}
.kgx-hud{position:absolute;left:16px;top:14px;z-index:10;pointer-events:none;max-width:280px}
.kgx-hud .t{font-size:13px;font-weight:700}
.kgx-hud .s{font-size:9px;color:#7a817f;margin-top:3px;line-height:1.5}
.kgx-search{position:absolute;left:50%;top:12px;transform:translateX(-50%);width:min(430px,46%);z-index:20}
.kgx-search input{width:100%;height:34px;border:1px solid #d6d0c4;background:rgba(255,255,252,.94);padding:0 11px;font:inherit;font-size:10px;outline:none;color:#273239;border-radius:6px}
.kgx-search input:focus{box-shadow:0 0 0 2px rgba(60,70,70,.06)}
.kgx-results{position:absolute;left:50%;top:50px;transform:translateX(-50%);width:min(430px,46%);z-index:26;background:rgba(251,250,246,.98);border:1px solid #d6d0c4;border-radius:6px;box-shadow:0 12px 30px rgba(0,0,0,.08);max-height:300px;overflow:auto}
.kgx-results .r{padding:8px 11px;border-bottom:1px solid #e6e2da;cursor:pointer;font-size:10px}
.kgx-results .r:last-child{border-bottom:0}
.kgx-results .r:hover,.kgx-results .r.kbd{background:#f1eee6}
.kgx-results .r small{display:block;color:#7c8587;margin-top:2px;font-size:8px}
.kgx-lensbar{position:absolute;right:14px;top:13px;display:flex;gap:5px;z-index:20;flex-wrap:wrap;justify-content:flex-end;max-width:46%}
.kgx-btn{font:inherit;cursor:pointer;background:rgba(252,251,247,.92);border:1px solid #d6d0c4;color:#586268;font-size:10px;padding:6px 10px;border-radius:5px;line-height:1}
.kgx-btn:hover{background:#fff}
.kgx-btn.active{background:#fff;color:#202a30;font-weight:700;border-color:#9aa4a8}
.kgx-btn.on{background:#efebf7;color:#4b3f82;border-color:#a99bd1;font-weight:700}
.kgx-relbar{position:absolute;right:14px;top:52px;display:flex;gap:5px;z-index:20;flex-wrap:wrap;justify-content:flex-end;max-width:40%}
.kgx-relbar .relKey{display:inline-block;width:15px;border-top:2px solid #566066;margin-right:4px;vertical-align:middle}
.kgx-relbar .relKey.pre{border-top-color:#4b6f88}
.kgx-relbar .relKey.rel{border-top:2px dashed #7d8587}
.kgx-relbar .relKey.assess{border-top-color:#b77b21}
.kgx-relbar .relKey.state{border-top-color:#c85b78}
.kgx-trail{position:absolute;right:14px;top:90px;display:flex;gap:5px;z-index:20}
.kgx-controls{position:absolute;left:14px;bottom:52px;display:flex;flex-direction:column;gap:5px;z-index:20}
.kgx-controls .kgx-btn{width:31px;height:31px;font-size:13px;padding:0}
.kgx-crumbs{position:absolute;left:16px;top:64px;z-index:14;font-size:9px;color:#70787a;background:rgba(251,250,246,.8);border:1px solid #e0dcd2;padding:5px 8px;border-radius:5px;max-width:min(460px,44%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kgx-crumbs .c{cursor:pointer;color:#5d696d}
.kgx-crumbs .c:hover{text-decoration:underline}
.kgx-crumbs .sep{color:#a0a4a2;margin:0 5px}
.kgx-status{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:12;background:rgba(251,250,246,.9);padding:5px 9px;color:#667074;font-size:9px;white-space:nowrap;pointer-events:none;max-width:70%;overflow:hidden;text-overflow:ellipsis;border:1px solid rgba(210,205,194,.65);border-radius:5px}
.kgx-selbar{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:24;display:none;align-items:center;gap:6px;background:rgba(251,250,246,.97);border:1px solid #d6d0c4;border-radius:6px;padding:6px 9px;font-size:9px;box-shadow:0 8px 20px rgba(0,0,0,.05)}
.kgx-selbar.show{display:flex}
.kgx-panel{position:absolute;right:14px;top:132px;width:min(360px,calc(100% - 28px));max-height:calc(100% - 190px);overflow:auto;display:none;z-index:30;background:rgba(251,250,246,.98);border:1px solid #d6d0c4;border-radius:8px;box-shadow:0 18px 40px rgba(0,0,0,.08);padding:15px}
.kgx-panel.show{display:block}
.kgx-panel .close{position:absolute;right:8px;top:6px;border:0;background:none;font-size:16px;color:#6e777b;cursor:pointer}
.kgx-panel h3{font-size:14px;font-weight:700;margin:0 26px 4px 0;line-height:1.25}
.kgx-panel .ptype{font-size:8px;color:#788083;margin:4px 0 10px;text-transform:uppercase;letter-spacing:.4px}
.kgx-panel .prow{display:flex;justify-content:space-between;gap:10px;font-size:10px;margin:7px 0}
.kgx-panel .prow b{text-align:right}
.kgx-panel .pbar{height:6px;background:#e6e1d7;margin:4px 0 10px;border-radius:3px;overflow:hidden}
.kgx-panel .pbar i{display:block;height:100%;background:#6656a9;border-radius:3px}
.kgx-panel .pbar.good i{background:#4a9b70}
.kgx-panel .pbar.warn i{background:#c38422}
.kgx-panel .pbar.weak i{background:#c85b78}
.kgx-panel .sect{margin:14px 0 6px;font-size:8px;text-transform:uppercase;letter-spacing:.3px;color:#7b8386;border-top:1px solid #e6e1d7;padding-top:9px}
.kgx-panel .sect:first-of-type{border-top:0;padding-top:0}
.kgx-panel .chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.kgx-panel .chip{border:1px solid #d5d0c5;background:#fff;padding:2px 6px;font-size:8px;border-radius:4px;color:#4e585d}
.kgx-panel .note{font-size:9px;line-height:1.6;color:#4e585d}
.kgx-panel .actions{display:flex;gap:6px;margin-top:13px;flex-wrap:wrap}
.kgx-panel .actions button{font:inherit;cursor:pointer;background:#fff;border:1px solid #d6d0c4;color:#39454a;font-size:9px;padding:7px 10px;border-radius:5px}
.kgx-panel .actions button:hover{background:#f1eee6}
.kgx-panel .edgeKind{display:inline-block;padding:2px 7px;border:1px solid #cfc9bd;background:#fff;border-radius:4px;font-size:9px;font-weight:700;color:#39454a}
.kgx-panel .quote{border-left:2px solid #9a958a;padding-left:9px;color:#4e585d;font-size:9px;line-height:1.6;margin-top:6px}
.kgx-minimap{position:absolute;right:14px;bottom:14px;z-index:22;background:rgba(251,250,246,.96);border:1px solid #d6d0c4;border-radius:7px;padding:5px;box-shadow:0 8px 22px rgba(0,0,0,.07);cursor:crosshair}
.kgx-minimap svg{display:block}
.kgx-minimap .miniRect{fill:rgba(102,86,169,.07);stroke:#6656a9;stroke-width:1.2}
.kgx-minimap .miniSel{fill:#6656a9}
.kgx-caption{position:absolute;left:16px;bottom:14px;z-index:8;font-size:8px;color:#8a918f;max-width:44%;line-height:1.5}
.kgx-lasso-hint{position:absolute;left:50%;bottom:72px;transform:translateX(-50%);z-index:23;background:#6656a9;color:#fff;font-size:9px;padding:5px 10px;border-radius:5px;display:none}
.kgx-lasso-hint.show{display:block}
@media(max-width:860px){.kgx-search{width:60%}.kgx-hud{max-width:180px}.kgx-panel{top:auto;bottom:12px;max-height:55%}.kgx-crumbs{top:104px;max-width:60%}}
`;
