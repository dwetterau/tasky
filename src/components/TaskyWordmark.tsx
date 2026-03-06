import Image from "next/image";
import Link from "next/link";

type TaskyWordmarkProps = {
  href?: string;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  priority?: boolean;
};

export function TaskyWordmark({
  href,
  className = "",
  imageClassName = "",
  textClassName = "",
  priority = false,
}: TaskyWordmarkProps) {
  const content = (
    <>
      <Image
        src="/tasky-frog.png"
        alt=""
        width={412}
        height={240}
        priority={priority}
        className={imageClassName}
      />
      <span className={`font-bold tracking-tight text-(--brand) ${textClassName}`}>Tasky</span>
    </>
  );

  const combinedClassName = `inline-flex items-center gap-1 ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={combinedClassName}>
        {content}
      </Link>
    );
  }

  return <div className={combinedClassName}>{content}</div>;
}
