import { useState, useEffect } from "react";
import { CMDKPalette } from "../cmdk-palette/CMDKPalette";

export default function CMDKPopup() {
  const [isOpen, setIsOpen] = useState(true);

  const handleClose = () => {
    // Close the popup window
    window.close();
  };

  return <CMDKPalette isOpen={isOpen} onClose={handleClose} noOverlay={true} />;
}
