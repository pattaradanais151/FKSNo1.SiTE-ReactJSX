import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { usePageTitle } from '../lib/utils.js'
import { Card, EmptyState } from '../components/UI.jsx'

export default function NotFound() {
  usePageTitle('ไม่พบหน้า')
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="ไม่พบหน้าที่ต้องการ"
        description="ลิงก์อาจไม่ถูกต้อง หรือหน้านี้ถูกย้ายไปแล้ว"
        action={
          <Link to="/" className="btn btn-primary">
            กลับหน้าภาพรวม
          </Link>
        }
      />
    </Card>
  )
}