update public.profiles
   set role = 'super_admin', is_active = true, full_name = 'ชื่อของคุณ'
 where email = 'you@example.com'
   and not exists (select 1 from public.profiles where role = 'super_admin');
