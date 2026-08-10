import Wordmark from "@/components/landing/Wordmark";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#17130F] antialiased">
      <header className="mx-auto max-w-[1120px] px-6 pt-7 md:px-10">
        <Wordmark />
      </header>
      <main className="flex justify-center px-6 pb-16 pt-14 md:pt-24">{children}</main>
    </div>
  );
}
