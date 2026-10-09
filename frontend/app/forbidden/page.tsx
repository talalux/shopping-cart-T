import { Forbidden } from "@/components/ui";

export default function ForbiddenPage() {
  return (
    <Forbidden code="403" title="หน้านี้สำหรับเจ้าหน้าที่เท่านั้น" text="บัญชีของคุณไม่มีสิทธิ์เข้าหน้านี้" href="/shop" cta="กลับหน้าหลัก" />
  );
}
