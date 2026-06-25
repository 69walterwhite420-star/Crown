import { ChannelStatusBanner } from "@/components/domain/channel-status";
import { AppHeader } from "@/components/layout/app-header";
import { StudioSidebar } from "@/components/layout/studio-sidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="mx-auto max-w-content px-4 pb-8 pt-4">
        {/* Контекстное напоминание (активация / приостановка) — во ВСЕХ вкладках студии, не отдельной страницей. */}
        <ChannelStatusBanner />
        {/* На md — грид [14rem_1fr]: сайдбар фиксируется (rail-pinned-left), его трек зарезервирован → контент
            не плывёт. col-start-2 на main: сайдбар вне грид-потока (fixed), иначе main ушёл бы в 1-й трек. */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[14rem_1fr] md:items-start">
          <StudioSidebar />
          <main className="min-w-0 md:col-start-2">{children}</main>
        </div>
      </div>
    </>
  );
}
