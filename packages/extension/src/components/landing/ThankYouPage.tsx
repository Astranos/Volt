import { useState, useEffect, useRef } from "react";
import {
  Command,
  MousePointer,
  Settings,
  Keyboard,
  Search,
  ArrowRight,
  CheckCircle,
  Github,
  TrendingUp,
  Barcode,
  Shield,
  Download,
  Star,
  Users,
  ChevronUp,
  Menu,
  X,
  Pin,
  ExternalLink,
  Info,
  Layout,
  Calculator,
  HelpCircle,
  List,
} from "lucide-react";
import { Dialog, DialogContent } from "../ui/dialog";

export default function ThankYouPage() {
  const [version, setVersion] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [isImageModalOpen, setIsImageModalOpen] = useState<boolean>(false);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [isStickyNavVisible, setIsStickyNavVisible] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<string>("hero");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Get extension version
    try {
      const manifest = chrome.runtime.getManifest();
      setVersion(manifest.version);
    } catch (e) {
      setVersion("1.0.0");
    }

    // Handle scroll events
    const handleScroll = () => {
      const scrollHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY;
      const progress = (currentScroll / scrollHeight) * 100;
      setScrollProgress(progress);

      // Show/hide sticky nav based on scroll position
      setIsStickyNavVisible(currentScroll > 300);

      // Update active section based on scroll position
      const sections = [
        { ref: heroRef, name: "hero" },
        { ref: featuresRef, name: "features" },
      ];

      for (const section of sections) {
        if (section.ref.current) {
          const { offsetTop, offsetHeight } = section.ref.current;
          if (
            currentScroll >= offsetTop - 100 &&
            currentScroll < offsetTop + offsetHeight - 100
          ) {
            setActiveSection(section.name);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleNavClick = (sectionName: string) => {
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      hero: heroRef,
      features: featuresRef,
    };

    const sectionRef = refs[sectionName];

    if (sectionRef?.current) {
      sectionRef.current.scrollIntoView({ behavior: "smooth" });
      setIsMobileMenuOpen(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleImageClick = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setIsImageModalOpen(true);
  };

  const mainFeatures = [
    {
      id: 1,
      title: "Quick Actions",
      description:
        "Highlight any text to instantly search eBay Sold Listings, PriceCharting, or UPC/MPN databases via the right-click context menu.",
      icon: MousePointer,
      image: "/assets/images/quick-actions.png",
    },
    {
      id: 2,
      title: "Click To Copy UPC Codes",
      description:
        "Automatically detects and highlights UPC codes on any webpage, allowing for instant one-click copying to your clipboard.",
      icon: Barcode,
      image: "/assets/images/upc-highlighter.png",
    },
    {
      id: 4,
      title: "Volt Tab",
      description:
        "Quickly get to any anything you need when opening a new tab.",
      icon: Layout,
      image: "/assets/images/new-tab.png",
    },
    {
      id: 5,
      title: "eBay Summary",
      description: "Get a quick summary when viewing search results on eBay.",
      icon: Info,
      image: "/assets/images/ebay-summary.png",
    },
    {
      id: 6,
      title: "Shopify Buttons",
      description:
        "Instantly check market pricing for items when viewing in Shopify.",
      icon: Shield,
      image: "/assets/images/shopify-buttons.png",
    },
    {
      id: 8,
      title: "Offer Calculator",
      description:
        "Automated buyout offer calculations based on projected sell prices with support for custom rate profiles.",
      icon: Calculator,
    },
    {
      id: 11,
      title: "Cost Breakdown",
      description:
        "Detailed profit margin analysis and cost distribution for inventory items.",
      icon: TrendingUp,
    },
    {
      id: 12,
      title: "Shopify Help",
      description:
        "Reference guide for Shopify tags and sales channel optimization.",
      icon: HelpCircle,
    },
    {
      id: 13,
      title: "Tab Management",
      description:
        "Lightweight utility to view and manage open browser tabs directly from the sidepanel.",
      icon: List,
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Progress Indicator */}
      <div
        className="fixed top-0 left-0 h-1 bg-green-600 z-[60] transition-all duration-100"
        style={{ width: `${scrollProgress}%` }}
      />

      {/* Sticky Navigation */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 transition-all duration-300 ${
          isStickyNavVisible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0"
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src="/assets/icons/logo.png"
                alt="Volt"
                className="w-8 h-8 rounded-lg"
              />
              <span className="font-semibold text-slate-900">Volt</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              {[
                { name: "hero", label: "Home" },
                { name: "features", label: "Features" },
              ].map((item) => (
                <button
                  key={item.name}
                  onClick={() => handleNavClick(item.name)}
                  className={`text-sm font-medium transition-colors ${
                    activeSection === item.name
                      ? "text-green-600"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              {isMobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[55] bg-white md:hidden">
          <div className="flex flex-col p-6 pt-20">
            {[
              { name: "hero", label: "Home" },
              { name: "features", label: "Features" },
            ].map((item) => (
              <button
                key={item.name}
                onClick={() => handleNavClick(item.name)}
                className={`text-lg font-medium py-3 text-left transition-colors ${
                  activeSection === item.name
                    ? "text-green-600"
                    : "text-slate-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Image Viewer Dialog */}
      <Dialog open={isImageModalOpen} onOpenChange={setIsImageModalOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 bg-white/90 backdrop-blur-sm border-0 shadow-2xl">
          <img
            src={selectedImage}
            alt="Enlarged view"
            className="w-full h-full object-contain rounded-lg"
          />
        </DialogContent>
      </Dialog>

      {/* Hero Section */}
      <section ref={heroRef} className="pt-32 pb-20 px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-8">
            <img
              src="/assets/icons/logo.png"
              alt="Volt"
              className="w-24 h-24 rounded-2xl mx-auto mb-8 shadow-xl"
            />
            <h1 className="text-5xl md:text-6xl font-extrabold text-slate-900 mb-6 tracking-tight">
              Thank You for Installing Volt
            </h1>
            <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              Volt is your all-in-one productivity suite for professional
              reselling. Streamline your workflow from sourcing to listing.
            </p>
          </div>

          <div className="bg-white border border-green-100 rounded-3xl p-8 md:p-10 mb-12 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-green-50 rounded-full -mr-16 -mt-16 opacity-50" />
            <div className="relative z-10">
              <div className="flex items-center justify-center gap-3 mb-6">
                <Pin className="w-8 h-8 text-green-600" />
                <h2 className="text-2xl font-bold text-slate-900">
                  Pin Volt to Your Toolbar
                </h2>
              </div>
              <div className="grid md:grid-cols-2 gap-8 text-left max-w-3xl mx-auto">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold">
                      1
                    </span>
                    <p className="text-slate-700">
                      Click the <strong>Extensions icon</strong> (puzzle piece)
                      in your toolbar.
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold">
                      2
                    </span>
                    <p className="text-slate-700">
                      Find <strong>Volt</strong> in your list of installed
                      extensions.
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold">
                      3
                    </span>
                    <p className="text-slate-700">
                      Click the <strong>pin icon</strong> next to Volt to keep
                      it visible.
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-bold">
                      4
                    </span>
                    <p className="font-medium text-green-700">
                      Access all features instantly from your browser toolbar!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-3xl p-8 md:p-10 mb-12 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-green-100 rounded-full -mr-16 -mt-16 opacity-50" />
            <div className="relative z-10">
              <div className="flex items-center justify-center gap-3 mb-6">
                <Layout className="w-8 h-8 text-green-600" />
                <h2 className="text-2xl font-bold text-slate-900">
                  Enable New Tab Features
                </h2>
              </div>
              <div className="max-w-2xl mx-auto text-center">
                <p className="text-slate-700 text-lg mb-6">
                  Chrome will ask if you want to change the new tab override
                  back to Google.
                </p>
                <div className="bg-white p-6 rounded-2xl border border-green-100 shadow-sm inline-block">
                  <p className="font-bold text-xl text-slate-900 mb-2">
                    Click{" "}
                    <span className="text-green-600 underline decoration-2 underline-offset-4">
                      Keep It
                    </span>
                  </p>
                  <p className="text-slate-600">
                    This allows Volt to provide your new custom dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => handleNavClick("features")}
              className="w-full sm:w-auto px-8 py-4 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-3 text-lg font-bold shadow-lg shadow-green-200"
            >
              <Search className="w-5 h-5" />
              Explore All Features
            </button>
            <button
              onClick={() =>
                chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
              }
              className="w-full sm:w-auto px-8 py-4 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-3 text-lg font-bold"
            >
              <Keyboard className="w-5 h-5" />
              Keyboard Shortcuts
            </button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section ref={featuresRef} className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              Everything You Need in One Extension
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Volt integrates market data, testing tools, and listing utilities
              directly into your browser.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {mainFeatures.map((feature) => (
              <div
                key={feature.id}
                className="group flex flex-col bg-slate-50 rounded-3xl p-8 border border-slate-100 hover:border-green-200 hover:bg-white hover:shadow-xl hover:shadow-green-50 transition-all duration-300"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="p-4 bg-white rounded-2xl shadow-sm text-green-600 group-hover:bg-green-600 group-hover:text-white transition-colors duration-300">
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Feature {feature.id.toString().padStart(2, "0")}
                  </span>
                </div>

                <h3 className="text-xl font-bold text-slate-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-slate-600 mb-6 leading-relaxed">
                  {feature.description}
                </p>

                {feature.image && (
                  <div
                    onClick={() => handleImageClick(feature.image!)}
                    className="mt-auto cursor-pointer relative overflow-hidden rounded-xl border border-slate-200 bg-white"
                  >
                    <img
                      src={feature.image}
                      alt={feature.title}
                      className="w-full h-40 object-cover object-top hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/5 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                      <div className="bg-white/90 p-2 rounded-full shadow-lg">
                        <ExternalLink className="w-4 h-4 text-slate-900" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10">
            <div className="flex items-center gap-4">
              <img
                src="/assets/icons/logo.png"
                alt="Volt"
                className="w-12 h-12 rounded-xl border border-white/10"
              />
              <div>
                <p className="text-xl font-bold">Volt</p>
                <p className="text-slate-400 text-sm">
                  Professional Productivity Suite for Resellers
                  {version && (
                    <span className="ml-3 px-2 py-0.5 bg-white/10 rounded text-xs">
                      v{version}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-8">
              <a
                href="https://github.com/JuanQuenga/volt-chrome-extension"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-400 hover:text-green-400 transition-colors font-medium"
              >
                <Github className="w-5 h-5" />
                <span>Source Code</span>
              </a>
              <div className="h-4 w-px bg-white/10 hidden sm:block" />
              <p className="text-slate-400 text-sm">Made by Juan Quenga</p>
              <div className="h-4 w-px bg-white/10 hidden sm:block" />
              <span className="text-xs text-slate-500 font-mono">
                AGPL-3.0 License
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating Action Button */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-8 right-8 z-40 w-14 h-14 bg-green-600 text-white rounded-full shadow-lg shadow-green-200 flex items-center justify-center hover:bg-green-700 transition-all duration-300 transform ${
          scrollProgress > 10
            ? "translate-y-0 opacity-100"
            : "translate-y-20 opacity-0"
        }`}
      >
        <ChevronUp className="w-6 h-6" />
      </button>
    </div>
  );
}
