"use client";

import { useState } from "react";
import TabNav, { type TabId } from "@/components/TabNav";
import ChatTab from "@/components/ChatTab";
import LifeTab from "@/components/LifeTab";
import CalendarTab from "@/components/CalendarTab";
import ImagesTab from "@/components/ImagesTab";
import SearchTab from "@/components/SearchTab";
import SettingsTab from "@/components/SettingsTab";

export default function Home() {
  const [tab, setTab] = useState<TabId>("chat");

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <TabNav active={tab} onChange={setTab} />
      <main className="flex-1 overflow-hidden">
        {tab === "chat" && <ChatTab />}
        {tab === "life" && <LifeTab />}
        {tab === "calendar" && <CalendarTab />}
        {tab === "images" && <ImagesTab />}
        {tab === "search" && <SearchTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
