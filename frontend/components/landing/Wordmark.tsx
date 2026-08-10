import Link from "next/link";

export default function Wordmark() {
  return (
    <Link href="/" className="flex items-baseline gap-2 text-[#17130F]">
      <span className="font-display text-[26px] leading-none tracking-[-0.01em]">Relogue</span>
      <span className="text-[9px] font-semibold tracking-[0.2em] text-[#6B6259]">CATERING</span>
    </Link>
  );
}
