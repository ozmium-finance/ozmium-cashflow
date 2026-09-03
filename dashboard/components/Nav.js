import Link from "next/link";
import { useRouter } from "next/router";

const LINKS = [
  { href: "/", label: "Operator" },
  { href: "/investor", label: "Investor" },
  { href: "/audit", label: "Audit trail" },
  { href: "/verify", label: "Verify" },
];

export default function Nav() {
  const { pathname } = useRouter();
  return (
    <nav>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
