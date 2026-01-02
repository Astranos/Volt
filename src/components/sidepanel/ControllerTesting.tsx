import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { Badge } from "../ui/badge";
import {
  Settings,
  Gamepad2,
  AlertCircle,
  Zap,
  RotateCcw,
  Play,
  Square,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import SidepanelLayout from "./SidepanelLayout";
import { Button } from "../ui/button";

// Circularity test types
interface CircularityPoint {
  x: number;
  y: number;
  timestamp: number;
}

interface CircularityResult {
  score: number; // 0-100, how circular the motion was
  avgRadius: number;
  radiusVariance: number;
  coverage: number; // percentage of circle covered
  direction: "cw" | "ccw" | "mixed";
}

export default function ControllerTesting() {
  // State for controller input values
  const [controllerState, setControllerState] = useState({
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    lt: 0,
    rt: 0,
    buttons: Array(20)
      .fill(0)
      .map(() => ({ pressed: false, value: 0 })),
    timestamp: 0,
  });

  // State for connected controllers
  const [connectedController, setConnectedController] = useState<{
    name: string;
    index: number;
    vibration: boolean;
  } | null>(null);

  // State for threshold settings
  const [thresholds, setThresholds] = useState({
    lightThreshold: 0.1,
    mediumThreshold: 0.25,
  });

  // State for auto-start setting
  const [autoStart, setAutoStart] = useState(true);

  // Circularity testing state - separate for left and right sticks
  const [leftCircularityTestActive, setLeftCircularityTestActive] =
    useState(false);
  const [rightCircularityTestActive, setRightCircularityTestActive] =
    useState(false);
  const [leftCircularityPoints, setLeftCircularityPoints] = useState<
    CircularityPoint[]
  >([]);
  const [rightCircularityPoints, setRightCircularityPoints] = useState<
    CircularityPoint[]
  >([]);
  const [leftCircularityResult, setLeftCircularityResult] =
    useState<CircularityResult | null>(null);
  const [rightCircularityResult, setRightCircularityResult] =
    useState<CircularityResult | null>(null);

  const leftCircularityPointsRef = useRef<CircularityPoint[]>([]);
  const rightCircularityPointsRef = useRef<CircularityPoint[]>([]);
  const leftCircularityTestActiveRef = useRef(false);
  const rightCircularityTestActiveRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    leftCircularityTestActiveRef.current = leftCircularityTestActive;
  }, [leftCircularityTestActive]);

  useEffect(() => {
    rightCircularityTestActiveRef.current = rightCircularityTestActive;
  }, [rightCircularityTestActive]);

  // Refs for SVG elements
  const lstickRef = useRef<SVGCircleElement>(null);
  const rstickRef = useRef<SVGCircleElement>(null);
  const l2barRef = useRef<SVGRectElement>(null);
  const r2barRef = useRef<SVGRectElement>(null);

  // Runtime refs for animation and cached DOM nodes
  const animationIdRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const svgCacheRef = useRef<{
    dup?: Element | null;
    ddown?: Element | null;
    dleft?: Element | null;
    dright?: Element | null;
    btop?: Element | null;
    bright?: Element | null;
    bbottom?: Element | null;
    bleft?: Element | null;
    lmeta?: Element | null;
    rmeta?: Element | null;
    l1?: Element | null;
    r1?: Element | null;
    l2?: Element | null;
    r2?: Element | null;
    touch?: Element | null;
  } | null>(null);

  // Controller button names
  const buttonNames = [
    "A/✕",
    "B/○",
    "X/□",
    "Y/△",
    "L1",
    "R1",
    "L2",
    "R2",
    "Back",
    "Start",
    "L3",
    "R3",
    "Up",
    "Down",
    "Left",
    "Right",
    "Meta",
    "Touch",
    "E1",
    "E2",
  ];

  // Load threshold settings and auto-start from chrome storage
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.sync.get(["cmdkSettings"], (result) => {
        if (result.cmdkSettings?.controllerTesting) {
          setThresholds({
            lightThreshold:
              result.cmdkSettings.controllerTesting.lightThreshold ?? 0.1,
            mediumThreshold:
              result.cmdkSettings.controllerTesting.mediumThreshold ?? 0.25,
          });
          setAutoStart(result.cmdkSettings.controllerTesting.autoStart ?? true);
        }
      });

      // Listen for settings changes
      const handleStorageChange = (changes: any) => {
        if (changes.cmdkSettings?.newValue?.controllerTesting) {
          setThresholds({
            lightThreshold:
              changes.cmdkSettings.newValue.controllerTesting.lightThreshold ??
              0.1,
            mediumThreshold:
              changes.cmdkSettings.newValue.controllerTesting.mediumThreshold ??
              0.25,
          });
          setAutoStart(
            changes.cmdkSettings.newValue.controllerTesting.autoStart ?? true
          );
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  const testVibration = () => {
    if (connectedController) {
      const gp = navigator.getGamepads()[connectedController.index];
      if (gp && gp.vibrationActuator) {
        gp.vibrationActuator.playEffect("dual-rumble", {
          startDelay: 0,
          duration: 500,
          weakMagnitude: 1.0,
          strongMagnitude: 1.0,
        });
      }
    }
  };

  // Circularity test functions
  const analyzeCircularity = useCallback(
    (points: CircularityPoint[]): CircularityResult => {
      if (points.length < 10) {
        return {
          score: 0,
          avgRadius: 0,
          radiusVariance: 0,
          coverage: 0,
          direction: "mixed",
        };
      }

      // Calculate center of all points
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

      // Calculate radii from center
      const radii = points.map((p) =>
        Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
      );
      const avgRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;

      // Calculate variance in radius (lower = more circular)
      const radiusVariance =
        radii.reduce((sum, r) => sum + (r - avgRadius) ** 2, 0) / radii.length;
      const normalizedVariance = Math.sqrt(radiusVariance) / (avgRadius || 1);

      // Calculate angular coverage (how much of the circle was covered)
      const angles = points.map((p) =>
        Math.atan2(p.y - centerY, p.x - centerX)
      );

      // Count unique angle sectors covered (divide circle into 12 sectors)
      const sectors = new Set<number>();
      angles.forEach((angle) => {
        const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12);
        sectors.add(sector);
      });
      const coverage = (sectors.size / 12) * 100;

      // Determine rotation direction
      let cwCount = 0;
      let ccwCount = 0;
      for (let i = 1; i < angles.length; i++) {
        let diff = angles[i] - angles[i - 1];
        // Normalize angle difference
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        if (diff > 0) ccwCount++;
        else if (diff < 0) cwCount++;
      }
      const direction: "cw" | "ccw" | "mixed" =
        cwCount > ccwCount * 1.5
          ? "cw"
          : ccwCount > cwCount * 1.5
          ? "ccw"
          : "mixed";

      // Calculate final score (0-100)
      // Score based on: low variance (40%), good coverage (40%), consistent direction (20%)
      const varianceScore = Math.max(0, 100 - normalizedVariance * 200) * 0.4;
      const coverageScore = coverage * 0.4;
      const directionScore = direction !== "mixed" ? 20 : 10;
      const score = Math.min(
        100,
        Math.round(varianceScore + coverageScore + directionScore)
      );

      return {
        score,
        avgRadius,
        radiusVariance: normalizedVariance,
        coverage,
        direction,
      };
    },
    []
  );

  const startCircularityTest = useCallback((stick: "left" | "right") => {
    if (stick === "left") {
      leftCircularityPointsRef.current = [];
      setLeftCircularityPoints([]);
      setLeftCircularityResult(null);
      setLeftCircularityTestActive(true);
    } else {
      rightCircularityPointsRef.current = [];
      setRightCircularityPoints([]);
      setRightCircularityResult(null);
      setRightCircularityTestActive(true);
    }
  }, []);

  // Sync circularity points to state periodically during active test for visual feedback
  useEffect(() => {
    if (!leftCircularityTestActive && !rightCircularityTestActive) return;
    const interval = setInterval(() => {
      if (leftCircularityTestActive) {
        setLeftCircularityPoints([...leftCircularityPointsRef.current]);
      }
      if (rightCircularityTestActive) {
        setRightCircularityPoints([...rightCircularityPointsRef.current]);
      }
    }, 100); // Update UI every 100ms
    return () => clearInterval(interval);
  }, [leftCircularityTestActive, rightCircularityTestActive]);

  const stopCircularityTest = useCallback(
    (stick: "left" | "right") => {
      if (stick === "left") {
        setLeftCircularityTestActive(false);
        const result = analyzeCircularity(leftCircularityPointsRef.current);
        setLeftCircularityResult(result);
        setLeftCircularityPoints([...leftCircularityPointsRef.current]);
      } else {
        setRightCircularityTestActive(false);
        const result = analyzeCircularity(rightCircularityPointsRef.current);
        setRightCircularityResult(result);
        setRightCircularityPoints([...rightCircularityPointsRef.current]);
      }
    },
    [analyzeCircularity]
  );

  const resetCircularityTest = useCallback((stick: "left" | "right") => {
    if (stick === "left") {
      leftCircularityPointsRef.current = [];
      setLeftCircularityPoints([]);
      setLeftCircularityResult(null);
      setLeftCircularityTestActive(false);
    } else {
      rightCircularityPointsRef.current = [];
      setRightCircularityPoints([]);
      setRightCircularityResult(null);
      setRightCircularityTestActive(false);
    }
  }, []);

  useEffect(() => {
    let selectedIndex = 0;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 1000 / 60; // 60fps for smooth visualizer
    let lastControllerState = {
      lx: 0,
      ly: 0,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 0,
      buttons: Array(20)
        .fill(null)
        .map(() => ({ pressed: false, value: 0 })),
      timestamp: 0,
    };

    const COLOR_GREEN = "rgba(34,197,94,0.85)";
    const COLOR_GREEN_LIGHT = "rgba(34,197,94,0.65)";
    const COLOR_ORANGE = "rgba(255,140,0,1.0)";
    const COLOR_RED = "rgba(239, 68, 68, 0.9)";
    const COLOR_ACTIVE = "rgba(34,197,94,0.9)"; // Green for active input (user preference)

    const getStickColor = (x: number, y: number): string => {
      const magnitude = Math.max(Math.abs(x), Math.abs(y));
      if (magnitude < 0.05) return "rgba(156,163,175,0.6)"; // Inactive gray
      if (magnitude < thresholds.lightThreshold) return COLOR_GREEN;
      if (magnitude < thresholds.mediumThreshold) return COLOR_ORANGE;
      return COLOR_RED;
    };

    const getTriggerColor = (value: number): string => {
      if (value < 0.05) return "rgba(64,64,64,0.2)"; // Default dark
      if (value < thresholds.lightThreshold) return COLOR_GREEN;
      if (value < thresholds.mediumThreshold) return COLOR_ORANGE;
      return COLOR_RED;
    };

    const setGroupPathFill = (groupEl: Element | null, pressed: boolean) => {
      if (!groupEl) return;
      const paths = (groupEl as HTMLElement).querySelectorAll("path");
      const p =
        paths && paths.length
          ? (paths[paths.length - 1] as SVGPathElement)
          : null;
      if (!p) return;
      p.setAttribute("fill", pressed ? COLOR_ACTIVE : "rgba(156,163,175,0.8)");
    };

    const setFill = (el: Element | null, pressed: boolean) => {
      if (!el) return;
      (el as SVGElement).setAttribute(
        "fill",
        pressed ? COLOR_ACTIVE : "rgba(64,64,64,0.2)"
      );
    };

    const cacheSvgElements = () => {
      // checking lstickRef to see if we are mounted
      if (
        svgCacheRef.current &&
        svgCacheRef.current.dup &&
        svgCacheRef.current.dup.isConnected
      )
        return;
      if (!lstickRef.current) {
        svgCacheRef.current = null;
        return;
      }

      svgCacheRef.current = {
        dup: document.getElementById("DUp"),
        ddown: document.getElementById("DDown"),
        dleft: document.getElementById("DLeft"),
        dright: document.getElementById("DRight"),
        btop: document.getElementById("BTop"),
        bright: document.getElementById("BRight"),
        bbottom: document.getElementById("BBottom"),
        bleft: document.getElementById("BLeft"),
        lmeta: document.getElementById("LMeta"),
        rmeta: document.getElementById("RMeta"),
        l1: document.getElementById("L1"),
        r1: document.getElementById("R1"),
        l2: document.getElementById("L2"),
        r2: document.getElementById("R2"),
        touch: document.getElementById("Touch"),
      };
    };

    // test

    function update(currentTime: number) {
      if (currentTime - lastUpdateTime < UPDATE_INTERVAL) {
        animationIdRef.current = requestAnimationFrame(update);
        return;
      }
      lastUpdateTime = currentTime;

      const gps = navigator.getGamepads?.() || [];
      const available: number[] = [];
      for (let i = 0; i < gps.length; i++) if (gps[i]) available.push(i);
      if (available.length && !available.includes(selectedIndex)) {
        selectedIndex = available[0];
      }

      const gp = gps[selectedIndex];

      // Update connected controller info
      if (gp && gp.id) {
        setConnectedController({
          name: gp.id,
          index: selectedIndex,
          vibration: !!gp.vibrationActuator,
        });
      } else {
        setConnectedController(null);
      }

      if (gp) {
        cacheSvgElements();
        const ax = (i: number) => Number((gp!.axes[i] || 0).toFixed(3));
        const btn = (i: number) =>
          gp!.buttons[i] || ({ value: 0, pressed: false } as any);

        const lx = ax(0),
          ly = ax(1),
          rx = ax(2),
          ry = ax(3);
        const lt = Number(btn(6).value.toFixed(3));
        const rt = Number(btn(7).value.toFixed(3));

        const newButtons = Array.from({ length: 20 }, (_, i) => {
          const b = btn(i);
          return { pressed: b.pressed, value: b.value };
        });

        const newState = {
          lx,
          ly,
          rx,
          ry,
          lt,
          rt,
          buttons: newButtons,
          timestamp: gp.timestamp,
        };

        // Only update React state if values actually changed significantly (for UI)
        // We throttle state updates to avoid React re-render spam, but update SVG directly every frame
        const hasChanged =
          Math.abs(lastControllerState.lx - lx) > 0.01 ||
          Math.abs(lastControllerState.ly - ly) > 0.01 ||
          Math.abs(lastControllerState.rx - rx) > 0.01 ||
          Math.abs(lastControllerState.ry - ry) > 0.01 ||
          Math.abs(lastControllerState.lt - lt) > 0.01 ||
          Math.abs(lastControllerState.rt - rt) > 0.01 ||
          newButtons.some(
            (btn, i) =>
              lastControllerState.buttons[i].pressed !== btn.pressed ||
              Math.abs(lastControllerState.buttons[i].value - btn.value) > 0.05
          );

        if (hasChanged) {
          setControllerState(newState);
          lastControllerState = { ...newState, buttons: [...newButtons] };
        }

        // Direct DOM manipulation for SVG elements (high performance)
        if (lstickRef.current) {
          lstickRef.current.setAttribute("cx", String(163 + lx * 25));
          lstickRef.current.setAttribute("cy", String(238 + ly * 25));
          lstickRef.current.setAttribute("fill", getStickColor(lx, ly));
        }

        if (rstickRef.current) {
          rstickRef.current.setAttribute("cx", String(278 + rx * 25));
          rstickRef.current.setAttribute("cy", String(238 + ry * 25));
          rstickRef.current.setAttribute("fill", getStickColor(rx, ry));
        }

        // Track circularity test points for left stick
        if (leftCircularityTestActiveRef.current) {
          const magnitude = Math.sqrt(lx * lx + ly * ly);
          if (magnitude > 0.15) {
            leftCircularityPointsRef.current.push({
              x: lx,
              y: ly,
              timestamp: currentTime,
            });
            if (leftCircularityPointsRef.current.length > 500) {
              leftCircularityPointsRef.current.shift();
            }
          }
        }

        // Track circularity test points for right stick
        if (rightCircularityTestActiveRef.current) {
          const magnitude = Math.sqrt(rx * rx + ry * ry);
          if (magnitude > 0.15) {
            rightCircularityPointsRef.current.push({
              x: rx,
              y: ry,
              timestamp: currentTime,
            });
            if (rightCircularityPointsRef.current.length > 500) {
              rightCircularityPointsRef.current.shift();
            }
          }
        }

        if (l2barRef.current) {
          const h = Math.max(0, Math.min(42, btn(6).value * 42));
          l2barRef.current.setAttribute("height", String(h));
          l2barRef.current.setAttribute("y", String(44.5 - h));
          l2barRef.current.setAttribute("fill", getTriggerColor(btn(6).value));
        }

        if (r2barRef.current) {
          const h = Math.max(0, Math.min(42, btn(7).value * 42));
          r2barRef.current.setAttribute("height", String(h));
          r2barRef.current.setAttribute("y", String(44.5 - h));
          r2barRef.current.setAttribute("fill", getTriggerColor(btn(7).value));
        }

        // Update button elements in SVG (cached)
        const {
          dup = null,
          ddown = null,
          dleft = null,
          dright = null,
          btop = null,
          bright = null,
          bbottom = null,
          bleft = null,
          lmeta = null,
          rmeta = null,
          l1 = null,
          r1 = null,
          l2 = null,
          r2 = null,
          touch = null,
        } = svgCacheRef.current || {};

        setGroupPathFill(dup, btn(12).pressed);
        setGroupPathFill(ddown, btn(13).pressed);
        setGroupPathFill(dleft, btn(14).pressed);
        setGroupPathFill(dright, btn(15).pressed);
        setGroupPathFill(btop, btn(3).pressed);
        setGroupPathFill(bright, btn(1).pressed);
        setGroupPathFill(bbottom, btn(0).pressed);
        setGroupPathFill(bleft, btn(2).pressed);

        if (lmeta)
          lmeta.setAttribute(
            "fill",
            btn(8).pressed ? COLOR_ACTIVE : "rgba(0,0,0,0)"
          );
        if (rmeta)
          rmeta.setAttribute(
            "fill",
            btn(9).pressed ? COLOR_ACTIVE : "rgba(0,0,0,0)"
          );
        setFill(l1, btn(4).pressed);
        setFill(r1, btn(5).pressed);
        setFill(touch, btn(17).pressed);

        if (l2) l2.setAttribute("fill", getTriggerColor(btn(6).value));
        if (r2) r2.setAttribute("fill", getTriggerColor(btn(7).value));
      }

      animationIdRef.current = requestAnimationFrame(update);
    }

    const startLoop = () => {
      if (animationIdRef.current != null) return;
      animationIdRef.current = requestAnimationFrame(update);
    };

    const stopLoop = () => {
      if (animationIdRef.current != null) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    };

    const onConnect = () => {
      startLoop();
    };
    const onDisconnect = () => {
      const any = (navigator.getGamepads?.() || []).some(Boolean);
      if (!any) {
        stopLoop();
        setConnectedController(null);
      }
    };

    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);

    // Only start polling if autoStart is enabled
    if (autoStart) {
      // Fallback: light polling until first gamepad appears
      pollIntervalRef.current = window.setInterval(() => {
        const gps = navigator.getGamepads?.() || [];
        if (gps.some(Boolean)) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          startLoop();
        }
      }, 500) as unknown as number;
    }

    return () => {
      stopLoop();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, [thresholds, autoStart]);

  return (
    <SidepanelLayout
      title="Gamepad Tester"
      actions={
        <div className="flex items-center gap-2">
          {connectedController && connectedController.vibration && (
            <Button
              variant="ghost"
              size="icon"
              onClick={testVibration}
              title="Test Vibration"
              className="h-8 w-8"
            >
              <Zap className="h-4 w-4 text-yellow-500" />
            </Button>
          )}
          <div
            className={`h-2 w-2 rounded-full ${
              connectedController ? "bg-green-500" : "bg-red-500"
            } animate-pulse`}
          />
        </div>
      }
    >
      <div className="flex flex-col min-h-0 h-full w-full overflow-hidden">
        <div className="px-4 py-2 border-b border-border/50 bg-muted/10 flex-shrink-0 overflow-hidden">
          <div
            className="text-sm font-medium truncate"
            title={connectedController?.name ?? "No Controller Detected"}
            style={{ maxWidth: "calc(100vw - 2rem)" }}
          >
            {connectedController?.name ?? "No Controller Detected"}
          </div>
          <div className="text-xs text-muted-foreground">
            Index: {connectedController?.index ?? "N/A"} •{" "}
            {controllerState.buttons.length} Buttons • 4 Axes
          </div>
        </div>

        <ScrollArea className="flex-1 w-full">
          <div className="p-4 space-y-6 w-full max-w-full overflow-hidden">
            {/* Visualizer */}
            <div className="flex justify-center">
              <div className="w-full max-w-[340px] aspect-[441/383]">
                <svg
                  viewBox="0 0 441 383"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full drop-shadow-md"
                >
                  <defs></defs>
                  <path
                    id="LOutline"
                    d="M220.5 294.5C220.5 294.5 195 294.5 150 294.5C105 294.5 81.5 378.5 49.5 378.5C17.5 378.5 4 363.9 4 317.5C4 271.1 43.5 165.5 55 137.5C66.5 109.5 95.5 92.0001 128 92.0001C154 92.0001 200.5 92.0001 220.5 92.0001"
                    fill="rgba(64,64,64,0.05)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <path
                    id="ROutline"
                    d="M220 294.5C220 294.5 245.5 294.5 290.5 294.5C335.5 294.5 359 378.5 391 378.5C423 378.5 436.5 363.9 436.5 317.5C436.5 271.1 397 165.5 385.5 137.5C374 109.5 345 92.0001 312.5 92.0001C286.5 92.0001 240 92.0001 220 92.0001"
                    fill="rgba(64,64,64,0.05)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  {/* Touchpad */}
                  <rect
                    id="Touch"
                    x="160"
                    y="100"
                    width="120"
                    height="80"
                    rx="10"
                    fill="rgba(64,64,64,0.1)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />

                  <circle
                    id="LStickOutline"
                    cx="163"
                    cy="238"
                    r="37.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="rgba(156,163,175,0.5)"
                    strokeWidth="2"
                  />
                  <circle
                    ref={lstickRef}
                    cx="163"
                    cy="238"
                    r="28"
                    fill="rgba(156,163,175,0.6)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <circle
                    id="RStickOutline"
                    cx="278"
                    cy="238"
                    r="37.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="rgba(156,163,175,0.5)"
                    strokeWidth="2"
                  />
                  <circle
                    ref={rstickRef}
                    cx="278"
                    cy="238"
                    r="28"
                    fill="rgba(156,163,175,0.6)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <circle
                    id="LMeta"
                    cx="140"
                    cy="110"
                    r="8"
                    fill="rgba(0,0,0,0)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <circle
                    id="RMeta"
                    cx="300"
                    cy="110"
                    r="8"
                    fill="rgba(0,0,0,0)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <circle
                    id="DOutline"
                    cx="113"
                    cy="160"
                    r="37.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="rgba(156,163,175,0.5)"
                    strokeWidth="2"
                  />
                  <g id="DUp" transform="translate(-53, -78)">
                    <mask id="path-8-inside-1" fill="white">
                      <path d="M177.669 222.335C180.793 219.21 180.816 213.997 176.868 212.014C176.327 211.743 175.776 211.491 175.215 211.258C172.182 210.002 168.931 209.355 165.648 209.355C162.365 209.355 159.114 210.002 156.081 211.258C155.521 211.491 154.969 211.743 154.429 212.014C150.48 213.997 150.503 219.21 153.627 222.335L159.991 228.698C163.116 231.823 168.181 231.823 171.305 228.698L177.669 222.335Z"></path>
                    </mask>
                    <path
                      d="M177.669 222.335C180.793 219.21 180.816 213.997 176.868 212.014C176.327 211.743 175.776 211.491 175.215 211.258C172.182 210.002 168.931 209.355 165.648 209.355C162.365 209.355 159.114 210.002 156.081 211.258C155.521 211.491 154.969 211.743 154.429 212.014C150.48 213.997 150.503 219.21 153.627 222.335L159.991 228.698C163.116 231.823 168.181 231.823 171.305 228.698L177.669 222.335Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-8-inside-1)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="DRight" transform="translate(-53, -78)">
                    <mask id="path-9-inside-2" fill="white">
                      <path d="M181.447 249.669C184.571 252.793 189.785 252.816 191.768 248.868C192.039 248.327 192.291 247.776 192.523 247.215C193.78 244.182 194.426 240.931 194.426 237.648C194.426 234.365 193.78 231.114 192.523 228.081C192.291 227.521 192.039 226.969 191.768 226.429C189.785 222.48 184.571 222.503 181.447 225.627L175.083 231.991C171.959 235.116 171.959 240.181 175.083 243.305L181.447 249.669Z"></path>
                    </mask>
                    <path
                      d="M181.447 249.669C184.571 252.793 189.785 252.816 191.768 248.868C192.039 248.327 192.291 247.776 192.523 247.215C193.78 244.182 194.426 240.931 194.426 237.648C194.426 234.365 193.78 231.114 192.523 228.081C192.291 227.521 192.039 226.969 191.768 226.429C189.785 222.48 184.571 222.503 181.447 225.627L175.083 231.991C171.959 235.116 171.959 240.181 175.083 243.305L181.447 249.669Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-9-inside-2)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="DDown" transform="translate(-53, -78)">
                    <mask id="path-10-inside-3" fill="white">
                      <path d="M154.113 253.447C150.989 256.571 150.966 261.785 154.914 263.767C155.455 264.039 156.006 264.291 156.566 264.523C159.6 265.78 162.85 266.426 166.134 266.426C169.417 266.426 172.667 265.78 175.701 264.523C176.261 264.291 176.812 264.039 177.353 263.767C181.301 261.785 181.279 256.571 178.154 253.447L171.79 247.083C168.666 243.959 163.601 243.959 160.477 247.083L154.113 253.447Z"></path>
                    </mask>
                    <path
                      d="M154.113 253.447C150.989 256.571 150.966 261.785 154.914 263.767C155.455 264.039 156.006 264.291 156.566 264.523C159.6 265.78 162.85 266.426 166.134 266.426C169.417 266.426 172.667 265.78 175.701 264.523C176.261 264.291 176.812 264.039 177.353 263.767C181.301 261.785 181.279 256.571 178.154 253.447L171.79 247.083C168.666 243.959 163.601 243.959 160.477 247.083L154.113 253.447Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-10-inside-3)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="DLeft" transform="translate(-53, -78)">
                    <mask id="path-11-inside-4" fill="white">
                      <path d="M150.335 226.113C147.21 222.989 141.997 222.966 140.014 226.914C139.743 227.455 139.491 228.006 139.258 228.566C138.002 231.6 137.355 234.85 137.355 238.134C137.355 241.417 138.002 244.667 139.258 247.701C139.491 248.261 139.743 248.812 140.014 249.353C141.997 253.301 147.21 253.279 150.335 250.154L156.698 243.79C159.823 240.666 159.823 235.601 156.698 232.477L150.335 226.113Z"></path>
                    </mask>
                    <path
                      d="M150.335 226.113C147.21 222.989 141.997 222.966 140.014 226.914C139.743 227.455 139.491 228.006 139.258 228.566C138.002 231.6 137.355 234.85 137.355 238.134C137.355 241.417 138.002 244.667 139.258 247.701C139.491 248.261 139.743 248.812 140.014 249.353C141.997 253.301 147.21 253.279 150.335 250.154L156.698 243.79C159.823 240.666 159.823 235.601 156.698 232.477L150.335 226.113Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-11-inside-4)"
                      className="text-foreground"
                    />
                  </g>
                  <circle
                    id="BOutline"
                    cx="329"
                    cy="160"
                    r="37.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="rgba(156,163,175,0.5)"
                    strokeWidth="2"
                  />
                  <g id="BTop">
                    <mask id="path-13-inside-5" fill="white">
                      <path d="M340.669 144.335C343.793 141.21 343.816 135.997 339.868 134.014C339.327 133.743 338.776 133.491 338.215 133.258C335.182 132.002 331.931 131.355 328.648 131.355C325.365 131.355 322.114 132.002 319.081 133.258C318.521 133.491 317.969 133.743 317.429 134.014C313.48 135.997 313.503 141.21 316.627 144.335L322.991 150.698C326.116 153.823 331.181 153.823 334.305 150.698L340.669 144.335Z"></path>
                    </mask>
                    <path
                      d="M340.669 144.335C343.793 141.21 343.816 135.997 339.868 134.014C339.327 133.743 338.776 133.491 338.215 133.258C335.182 132.002 331.931 131.355 328.648 131.355C325.365 131.355 322.114 132.002 319.081 133.258C318.521 133.491 317.969 133.743 317.429 134.014C313.48 135.997 313.503 141.21 316.627 144.335L322.991 150.698C326.116 153.823 331.181 153.823 334.305 150.698L340.669 144.335Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-13-inside-5)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="BRight">
                    <mask id="path-14-inside-6" fill="white">
                      <path d="M344.447 171.669C347.571 174.793 352.785 174.816 354.768 170.868C355.039 170.327 355.291 169.776 355.523 169.215C356.78 166.182 357.426 162.931 357.426 159.648C357.426 156.365 356.78 153.114 355.523 150.081C355.291 149.521 355.039 148.969 354.768 148.429C352.785 144.48 347.571 144.503 344.447 147.627L338.083 153.991C334.959 157.116 334.959 162.181 338.083 165.305L344.447 171.669Z"></path>
                    </mask>
                    <path
                      d="M344.447 171.669C347.571 174.793 352.785 174.816 354.768 170.868C355.039 170.327 355.291 169.776 355.523 169.215C356.78 166.182 357.426 162.931 357.426 159.648C357.426 156.365 356.78 153.114 355.523 150.081C355.291 149.521 355.039 148.969 354.768 148.429C352.785 144.48 347.571 144.503 344.447 147.627L338.083 153.991C334.959 157.116 334.959 162.181 338.083 165.305L344.447 171.669Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-14-inside-6)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="BBottom">
                    <mask id="path-15-inside-7" fill="white">
                      <path d="M317.113 175.447C313.989 178.571 313.966 183.785 317.914 185.767C318.455 186.039 319.006 186.291 319.566 186.523C322.6 187.78 325.85 188.426 329.134 188.426C332.417 188.426 335.667 187.78 338.701 186.523C339.261 186.291 339.812 186.039 340.353 185.767C344.301 183.785 344.279 178.571 341.154 175.447L334.79 169.083C331.666 165.959 326.601 165.959 323.477 169.083L317.113 175.447Z"></path>
                    </mask>
                    <path
                      d="M317.113 175.447C313.989 178.571 313.966 183.785 317.914 185.767C318.455 186.039 319.006 186.291 319.566 186.523C322.6 187.78 325.85 188.426 329.134 188.426C332.417 188.426 335.667 187.78 338.701 186.523C339.261 186.291 339.812 186.039 340.353 185.767C344.301 183.785 344.279 178.571 341.154 175.447L334.79 169.083C331.666 165.959 326.601 165.959 323.477 169.083L317.113 175.447Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-15-inside-7)"
                      className="text-foreground"
                    />
                  </g>
                  <g id="BLeft">
                    <mask id="path-16-inside-8" fill="white">
                      <path d="M313.335 148.113C310.21 144.989 304.997 144.966 303.014 148.914C302.743 149.455 302.491 150.006 302.258 150.566C301.002 153.6 300.355 156.851 300.355 160.134C300.355 163.417 301.002 166.668 302.258 169.701C302.491 170.261 302.743 170.812 303.014 171.353C304.997 175.301 310.21 175.279 313.335 172.154L319.698 165.79C322.823 162.666 322.823 157.601 319.698 154.477L313.335 148.113Z"></path>
                    </mask>
                    <path
                      d="M313.335 148.113C310.21 144.989 304.997 144.966 303.014 148.914C302.743 149.455 302.491 150.006 302.258 150.566C301.002 153.6 300.355 156.851 300.355 160.134C300.355 163.417 301.002 166.668 302.258 169.701C302.491 170.261 302.743 170.812 303.014 171.353C304.997 175.301 310.21 175.279 313.335 172.154L319.698 165.79C322.823 162.666 322.823 157.601 319.698 154.477L313.335 148.113Z"
                      fill="rgba(156,163,175,0.8)"
                      stroke="currentColor"
                      strokeWidth="4"
                      mask="url(#path-16-inside-8)"
                      className="text-foreground"
                    />
                  </g>
                  <rect
                    id="L1"
                    x="111.5"
                    y="65"
                    width="41"
                    height="13"
                    rx="6.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <rect
                    id="R1"
                    x="289.5"
                    y="65"
                    width="41"
                    height="13"
                    rx="6.5"
                    fill="rgba(64,64,64,0.1)"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />
                  <g transform="translate(0, 8)">
                    <path
                      id="L2"
                      d="M152.5 37C152.5 41.1421 149.142 44.5 145 44.5H132C127.858 44.5 124.5 41.1421 124.5 37V16.5C124.5 8.76801 130.768 2.5 138.5 2.5C146.232 2.5 152.5 8.76801 152.5 16.5V37Z"
                      fill="rgba(64,64,64,0.1)"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-foreground"
                    />
                    <path
                      id="R2"
                      d="M317.5 37C317.5 41.1421 314.142 44.5 310 44.5H297C292.858 44.5 289.5 41.1421 289.5 37V16.5C289.5 8.76801 295.768 2.5 303.5 2.5C311.232 2.5 317.5 8.76801 317.5 16.5V37Z"
                      fill="rgba(64,64,64,0.1)"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-foreground"
                    />
                    <rect
                      ref={l2barRef}
                      x="104.5"
                      y="2.5"
                      width="10"
                      height="0"
                      fill="rgba(156,163,175,0.6)"
                    />
                    <rect
                      ref={r2barRef}
                      x="329.5"
                      y="2.5"
                      width="10"
                      height="0"
                      fill="rgba(156,163,175,0.6)"
                    />
                  </g>
                </svg>
              </div>
            </div>

            <Separator />

            {/* Data Display */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                    Axes
                  </h4>
                  <div className="space-y-2">
                    {/* Sticks */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-4 font-mono text-muted-foreground">
                        L
                      </span>
                      <div className="flex-1 flex gap-1">
                        <div className="flex-1 bg-muted rounded overflow-hidden h-4 relative">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border -translate-x-1/2" />
                          <div
                            className="absolute top-0 bottom-0 bg-green-500/50"
                            style={{
                              left:
                                controllerState.lx < 0
                                  ? `${(controllerState.lx + 1) * 50}%`
                                  : "50%",
                              width: `${Math.abs(controllerState.lx) * 50}%`,
                            }}
                          />
                        </div>
                        <div className="flex-1 bg-muted rounded overflow-hidden h-4 relative">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border -translate-x-1/2" />
                          <div
                            className="absolute top-0 bottom-0 bg-green-500/50"
                            style={{
                              left:
                                controllerState.ly < 0
                                  ? `${(controllerState.ly + 1) * 50}%`
                                  : "50%",
                              width: `${Math.abs(controllerState.ly) * 50}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-4 font-mono text-muted-foreground">
                        R
                      </span>
                      <div className="flex-1 flex gap-1">
                        <div className="flex-1 bg-muted rounded overflow-hidden h-4 relative">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border -translate-x-1/2" />
                          <div
                            className="absolute top-0 bottom-0 bg-green-500/50"
                            style={{
                              left:
                                controllerState.rx < 0
                                  ? `${(controllerState.rx + 1) * 50}%`
                                  : "50%",
                              width: `${Math.abs(controllerState.rx) * 50}%`,
                            }}
                          />
                        </div>
                        <div className="flex-1 bg-muted rounded overflow-hidden h-4 relative">
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border -translate-x-1/2" />
                          <div
                            className="absolute top-0 bottom-0 bg-green-500/50"
                            style={{
                              left:
                                controllerState.ry < 0
                                  ? `${(controllerState.ry + 1) * 50}%`
                                  : "50%",
                              width: `${Math.abs(controllerState.ry) * 50}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                    Triggers
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-4 font-mono text-muted-foreground">
                        LT
                      </span>
                      <Progress
                        value={controllerState.lt * 100}
                        className="h-4 flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-4 font-mono text-muted-foreground">
                        RT
                      </span>
                      <Progress
                        value={controllerState.rt * 100}
                        className="h-4 flex-1"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                  Buttons
                </h4>
                <div className="grid grid-cols-10 gap-1.5">
                  {controllerState.buttons.map((btn, i) => (
                    <div
                      key={i}
                      title={buttonNames[i] || `Button ${i}`}
                      className={`
                        aspect-square rounded border transition-colors
                        ${
                          btn.pressed
                            ? "bg-green-500 border-green-600"
                            : "bg-muted/30 border-transparent"
                        }
                      `}
                    />
                  ))}
                </div>
              </div>

              <Separator />

              {/* Circularity Testing */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4" />
                    Circularity Test
                  </h4>
                  <div className="flex items-center gap-1.5">
                    {/* Left Stick Controls */}
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-md p-0.5">
                      <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">
                        L
                      </span>
                      {!leftCircularityTestActive ? (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startCircularityTest("left")}
                            disabled={!connectedController}
                            title="Start Left Test"
                          >
                            <Play className="h-5 w-5" />
                          </Button>
                          {leftCircularityResult && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => resetCircularityTest("left")}
                              title="Reset Left"
                            >
                              <RotateCcw className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600"
                          onClick={() => stopCircularityTest("left")}
                          title="Stop Left"
                        >
                          <Square className="h-5 w-5" />
                        </Button>
                      )}
                    </div>

                    {/* Right Stick Controls */}
                    <div className="flex items-center gap-0.5 bg-muted/30 rounded-md p-0.5">
                      <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">
                        R
                      </span>
                      {!rightCircularityTestActive ? (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startCircularityTest("right")}
                            disabled={!connectedController}
                            title="Start Right Test"
                          >
                            <Play className="h-5 w-5" />
                          </Button>
                          {rightCircularityResult && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => resetCircularityTest("right")}
                              title="Reset Right"
                            >
                              <RotateCcw className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600"
                          onClick={() => stopCircularityTest("right")}
                          title="Stop Right"
                        >
                          <Square className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Side-by-side circular visualization areas */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Left Stick */}
                  <div className="space-y-2">
                    <div className="relative w-full aspect-square max-w-[140px] mx-auto">
                      <svg
                        viewBox="-1.2 -1.2 2.4 2.4"
                        className="w-full h-full"
                      >
                        <circle
                          cx="0"
                          cy="0"
                          r="1"
                          fill="rgba(64,64,64,0.1)"
                          stroke="rgba(156,163,175,0.3)"
                          strokeWidth="0.02"
                        />
                        <circle
                          cx="0"
                          cy="0"
                          r="0.5"
                          fill="none"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                          strokeDasharray="0.05 0.05"
                        />
                        <line
                          x1="-1"
                          y1="0"
                          x2="1"
                          y2="0"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                        />
                        <line
                          x1="0"
                          y1="-1"
                          x2="0"
                          y2="1"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                        />
                        {leftCircularityPoints.length > 1 && (
                          <path
                            d={`M ${leftCircularityPoints[0].x} ${
                              leftCircularityPoints[0].y
                            } ${leftCircularityPoints
                              .slice(1)
                              .map((p) => `L ${p.x} ${p.y}`)
                              .join(" ")}`}
                            fill="none"
                            stroke={
                              leftCircularityTestActive
                                ? "rgba(34,197,94,0.8)"
                                : "rgba(59,130,246,0.6)"
                            }
                            strokeWidth="0.04"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        <circle
                          cx={controllerState.lx}
                          cy={controllerState.ly}
                          r="0.08"
                          fill={
                            leftCircularityTestActive
                              ? "rgba(34,197,94,0.9)"
                              : "rgba(156,163,175,0.8)"
                          }
                          stroke="currentColor"
                          strokeWidth="0.02"
                          className="text-foreground"
                        />
                      </svg>
                      {!leftCircularityTestActive && leftCircularityResult && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="text-center bg-background/80 rounded-lg px-2 py-1">
                            <div
                              className={`text-lg font-bold ${
                                leftCircularityResult.score >= 80
                                  ? "text-green-500"
                                  : leftCircularityResult.score >= 60
                                  ? "text-yellow-500"
                                  : leftCircularityResult.score >= 40
                                  ? "text-orange-500"
                                  : "text-red-500"
                              }`}
                            >
                              {leftCircularityResult.score}%
                            </div>
                            <div className="text-[8px] text-muted-foreground">
                              {leftCircularityResult.direction === "cw"
                                ? "CW"
                                : leftCircularityResult.direction === "ccw"
                                ? "CCW"
                                : "Mixed"}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {leftCircularityTestActive && (
                      <p className="text-[9px] text-green-500 text-center animate-pulse">
                        Recording...
                      </p>
                    )}
                    {leftCircularityResult && !leftCircularityTestActive && (
                      <div className="grid grid-cols-2 gap-1 text-center">
                        <div className="bg-muted/30 rounded px-1 py-0.5">
                          <div className="text-[8px] text-muted-foreground">
                            Cov
                          </div>
                          <div className="text-[10px] font-medium">
                            {Math.round(leftCircularityResult.coverage)}%
                          </div>
                        </div>
                        <div className="bg-muted/30 rounded px-1 py-0.5">
                          <div className="text-[8px] text-muted-foreground">
                            Var
                          </div>
                          <div className="text-[10px] font-medium">
                            {(
                              leftCircularityResult.radiusVariance * 100
                            ).toFixed(0)}
                            %
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Stick */}
                  <div className="space-y-2">
                    <div className="relative w-full aspect-square max-w-[140px] mx-auto">
                      <svg
                        viewBox="-1.2 -1.2 2.4 2.4"
                        className="w-full h-full"
                      >
                        <circle
                          cx="0"
                          cy="0"
                          r="1"
                          fill="rgba(64,64,64,0.1)"
                          stroke="rgba(156,163,175,0.3)"
                          strokeWidth="0.02"
                        />
                        <circle
                          cx="0"
                          cy="0"
                          r="0.5"
                          fill="none"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                          strokeDasharray="0.05 0.05"
                        />
                        <line
                          x1="-1"
                          y1="0"
                          x2="1"
                          y2="0"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                        />
                        <line
                          x1="0"
                          y1="-1"
                          x2="0"
                          y2="1"
                          stroke="rgba(156,163,175,0.2)"
                          strokeWidth="0.01"
                        />
                        {rightCircularityPoints.length > 1 && (
                          <path
                            d={`M ${rightCircularityPoints[0].x} ${
                              rightCircularityPoints[0].y
                            } ${rightCircularityPoints
                              .slice(1)
                              .map((p) => `L ${p.x} ${p.y}`)
                              .join(" ")}`}
                            fill="none"
                            stroke={
                              rightCircularityTestActive
                                ? "rgba(34,197,94,0.8)"
                                : "rgba(59,130,246,0.6)"
                            }
                            strokeWidth="0.04"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        <circle
                          cx={controllerState.rx}
                          cy={controllerState.ry}
                          r="0.08"
                          fill={
                            rightCircularityTestActive
                              ? "rgba(34,197,94,0.9)"
                              : "rgba(156,163,175,0.8)"
                          }
                          stroke="currentColor"
                          strokeWidth="0.02"
                          className="text-foreground"
                        />
                      </svg>
                      {!rightCircularityTestActive &&
                        rightCircularityResult && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center bg-background/80 rounded-lg px-2 py-1">
                              <div
                                className={`text-lg font-bold ${
                                  rightCircularityResult.score >= 80
                                    ? "text-green-500"
                                    : rightCircularityResult.score >= 60
                                    ? "text-yellow-500"
                                    : rightCircularityResult.score >= 40
                                    ? "text-orange-500"
                                    : "text-red-500"
                                }`}
                              >
                                {rightCircularityResult.score}%
                              </div>
                              <div className="text-[8px] text-muted-foreground">
                                {rightCircularityResult.direction === "cw"
                                  ? "CW"
                                  : rightCircularityResult.direction === "ccw"
                                  ? "CCW"
                                  : "Mixed"}
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                    {rightCircularityTestActive && (
                      <p className="text-[9px] text-green-500 text-center animate-pulse">
                        Recording...
                      </p>
                    )}
                    {rightCircularityResult && !rightCircularityTestActive && (
                      <div className="grid grid-cols-2 gap-1 text-center">
                        <div className="bg-muted/30 rounded px-1 py-0.5">
                          <div className="text-[8px] text-muted-foreground">
                            Cov
                          </div>
                          <div className="text-[10px] font-medium">
                            {Math.round(rightCircularityResult.coverage)}%
                          </div>
                        </div>
                        <div className="bg-muted/30 rounded px-1 py-0.5">
                          <div className="text-[8px] text-muted-foreground">
                            Var
                          </div>
                          <div className="text-[10px] font-medium">
                            {(
                              rightCircularityResult.radiusVariance * 100
                            ).toFixed(0)}
                            %
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Instructions when neither has result */}
                {!leftCircularityResult &&
                  !rightCircularityResult &&
                  !leftCircularityTestActive &&
                  !rightCircularityTestActive && (
                    <p className="text-[10px] text-muted-foreground text-center">
                      Test stick circularity. Press play and rotate each stick
                      in a full circle.
                    </p>
                  )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </SidepanelLayout>
  );
}
