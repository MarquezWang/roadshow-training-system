export function BeianLink({
  className,
}: Readonly<{ className?: string }>) {
  return (
    <a
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      粤ICP备2026088434号
    </a>
  );
}
