begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id), display_name text not null check(length(trim(display_name)) between 1 and 80),
 email text not null, role text not null default 'member' check(role in ('admin','member')),
 is_active boolean not null default false, created_at timestamptz not null default now(), last_invited_at timestamptz
);
create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 1 and 80),
 code text not null unique check(code ~ '^[A-Z0-9_-]{1,20}$'), is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.customer_members (
 customer_id uuid references public.customers(id) not null, user_id uuid references public.profiles(id) not null,
 created_at timestamptz not null default now(), primary key(customer_id,user_id)
);
create table public.requests (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 customer_id uuid not null references public.customers(id), title text not null check(length(trim(title)) between 1 and 150),
 description text not null check(length(trim(description)) between 1 and 10000), requester_name text check(length(requester_name)<=80),
 requested_on date not null, status text not null default 'received' check(status in ('received','in_progress','verification','completed')),
 requires_deployment boolean not null default true, test_deployed_at timestamptz, production_deployed_at timestamptz,
 action_summary text not null default '' check(length(action_summary)<=10000),
 created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
 version integer not null default 1,
 check(requires_deployment or (test_deployed_at is null and production_deployed_at is null))
);
create table public.request_activities (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests(id),
 kind text not null check(kind in ('action','note','system')), body text not null check(length(trim(body)) between 1 and 10000),
 metadata jsonb not null default '{}', created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.request_attachments (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests(id), storage_path text not null unique,
 original_name text not null check(length(original_name) between 1 and 255),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 2097152), state text not null default 'pending' check(state in ('pending','ready')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index on public.customer_members(user_id,customer_id);
create index on public.requests(customer_id,archived_at,status,updated_at desc);
create index on public.requests(customer_id,requested_on);
create index on public.request_activities(request_id,created_at);
create index on public.request_attachments(request_id,state);

create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,display_name) values(new.id,new.email,coalesce(nullif(left(trim(new.raw_user_meta_data->>'display_name'),80),''),split_part(new.email,'@',1)));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.new_profile();
create function private.sync_email() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.profiles set email=new.email where id=new.id; return new; end $$;
create trigger on_auth_email_updated after update of email on auth.users for each row execute function private.sync_email();

create function private.is_active_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='admin')
$$;
create function private.can_access_customer(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and
 (p.role='admin' or exists(select 1 from public.customer_members m where m.customer_id=cid and m.user_id=p.id)))
$$;
create function private.can_read_request(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.requests r where r.id=rid and private.can_access_customer(r.customer_id))
$$;
create function private.assert_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_active_admin() then raise exception '관리자 권한이 필요합니다'; end if; end $$;
create function private.assert_writable(rid uuid) returns public.requests language plpgsql security definer set search_path='' as $$
declare r public.requests;
begin
 select * into r from public.requests where id=rid for update;
 if r.id is null or not private.can_access_customer(r.customer_id) then raise exception '접근 권한이 없습니다'; end if;
 if r.archived_at is not null or not exists(select 1 from public.customers where id=r.customer_id and is_active) then raise exception '읽기 전용 요청입니다'; end if;
 return r;
end $$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.customer_members enable row level security;
alter table public.requests enable row level security;
alter table public.request_activities enable row level security;
alter table public.request_attachments enable row level security;
revoke all on public.profiles,public.customers,public.customer_members,public.requests,public.request_activities,public.request_attachments from anon,authenticated;
grant select on public.profiles,public.customers,public.customer_members,public.requests,public.request_activities,public.request_attachments to authenticated;
grant select,update on public.profiles to service_role;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or private.is_active_admin());
create policy customers_read on public.customers for select to authenticated using(private.can_access_customer(id));
create policy members_read on public.customer_members for select to authenticated using(private.is_active_admin() or (user_id=auth.uid() and private.can_access_customer(customer_id)));
create policy requests_read on public.requests for select to authenticated using(private.can_access_customer(customer_id));
create policy activities_read on public.request_activities for select to authenticated using(private.can_read_request(request_id));
create policy attachments_read on public.request_attachments for select to authenticated using(private.can_read_request(request_id));

create function public.get_people() returns table(id uuid,display_name text) language sql stable security definer set search_path='' as $$
 select p.id,p.display_name from public.profiles p
 where exists(select 1 from public.profiles me where me.id=auth.uid() and me.is_active) and
 (p.id=auth.uid() or private.is_active_admin() or exists(select 1 from public.customer_members m where m.user_id=p.id and private.can_access_customer(m.customer_id)))
$$;
create function public.update_display_name(name text) returns void language plpgsql security definer set search_path='' as $$
begin update public.profiles set display_name=trim(name) where id=auth.uid() and is_active; if not found then raise exception '접근 권한이 없습니다'; end if; end $$;

create function public.create_request(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; cid uuid=(payload->>'customer_id')::uuid;
begin
 if not private.can_access_customer(cid) then raise exception '접근 권한이 없습니다'; end if;
 perform 1 from public.customers where id=cid and is_active for share;
 if not found then raise exception '사용 중지 고객사는 읽기 전용입니다'; end if;
 insert into public.requests(customer_id,title,description,requested_on,requester_name,requires_deployment,created_by,updated_by)
 values(cid,trim(payload->>'title'),trim(payload->>'description'),(payload->>'requested_on')::date,nullif(trim(payload->>'requester_name'),''),coalesce((payload->>'requires_deployment')::boolean,true),auth.uid(),auth.uid()) returning id into rid;
 return rid;
end $$;
create function public.update_request(id uuid, expected_version integer, patch jsonb) returns public.requests language plpgsql security definer set search_path='' as $$
declare r public.requests; old_status text; old_test timestamptz; old_prod timestamptz; old_required boolean;
begin
 r=private.assert_writable(id);
 if r.version is distinct from expected_version then raise exception '다른 사용자가 수정했습니다. 새로고침 후 다시 저장하세요'; end if;
 if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k not in ('title','description','requester_name','requested_on','status','requires_deployment','test_deployed_at','production_deployed_at','action_summary')) then raise exception '허용되지 않는 변경 항목입니다'; end if;
 old_status=r.status; old_test=r.test_deployed_at; old_prod=r.production_deployed_at; old_required=r.requires_deployment;
 r=jsonb_populate_record(r,patch);
 if not r.requires_deployment then r.test_deployed_at=null; r.production_deployed_at=null; end if;
 if r.test_deployed_at>now() or r.production_deployed_at>now() then raise exception '배포일은 미래일 수 없습니다'; end if;
 update public.requests q set title=trim(r.title),description=trim(r.description),requester_name=r.requester_name,requested_on=r.requested_on,status=r.status,
 requires_deployment=r.requires_deployment,test_deployed_at=r.test_deployed_at,production_deployed_at=r.production_deployed_at,action_summary=r.action_summary,
 updated_by=auth.uid(),updated_at=now(),version=q.version+1 where q.id=update_request.id returning q.* into r;
 if old_status is distinct from r.status or old_test is distinct from r.test_deployed_at or old_prod is distinct from r.production_deployed_at or old_required is distinct from r.requires_deployment then
 insert into public.request_activities(request_id,kind,body,metadata,created_by) values(r.id,'system','진행·배포 정보 변경',jsonb_build_object('before',jsonb_build_object('status',old_status,'test',old_test,'production',old_prod,'required',old_required),'after',jsonb_build_object('status',r.status,'test',r.test_deployed_at,'production',r.production_deployed_at,'required',r.requires_deployment)),auth.uid()); end if;
 return r;
end $$;
create function public.add_request_activity(request_id uuid,kind text,body text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin perform private.assert_writable(request_id); if kind not in ('action','note') then raise exception '허용되지 않는 기록 유형입니다'; end if;
 insert into public.request_activities(request_id,kind,body,created_by) values(request_id,kind,trim(body),auth.uid()) returning id into result; return result; end $$;
create function public.set_request_archived(id uuid,expected_version integer,archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.requests;
begin
 perform private.assert_admin(); select * into r from public.requests q where q.id=set_request_archived.id for update;
 if r.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
 if r.version is distinct from expected_version then raise exception '다른 사용자가 수정했습니다'; end if;
 update public.requests q set archived_at=case when archived then now() else null end,version=q.version+1,updated_by=auth.uid(),updated_at=now() where q.id=r.id;
 insert into public.request_activities(request_id,kind,body,created_by) values(r.id,'system',case when archived then '요청 보관' else '요청 복원' end,auth.uid());
end $$;
create function public.save_customer(id uuid,name text,code text,is_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin perform private.assert_admin();
 if id is null then insert into public.customers(name,code,is_active) values(trim(name),upper(trim(code)),is_active) returning customers.id into result;
 else update public.customers c set name=trim(save_customer.name),code=upper(trim(save_customer.code)),is_active=save_customer.is_active,updated_at=now() where c.id=save_customer.id returning c.id into result; end if;
 if result is null then raise exception '고객사를 찾을 수 없습니다'; end if; return result;
end $$;
create function public.set_customer_members(user_id uuid,customer_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_admin(); perform 1 from public.profiles p where p.id=set_customer_members.user_id for update;
 if not found then raise exception '사용자를 찾을 수 없습니다'; end if;
 delete from public.customer_members m where m.user_id=set_customer_members.user_id;
 insert into public.customer_members(customer_id,user_id) select distinct unnest(customer_ids),user_id;
end $$;
create function public.set_user_access(user_id uuid,role text,is_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(723419); perform private.assert_admin();
 if role not in ('admin','member') or role is null or is_active is null then raise exception '잘못된 권한 값입니다'; end if;
 if exists(select 1 from public.profiles p where p.id=user_id and p.role='admin' and p.is_active) and (role<>'admin' or not is_active) and
 (select count(*) from public.profiles p where p.role='admin' and p.is_active)<=1 then raise exception '마지막 활성 관리자는 차단·강등할 수 없습니다'; end if;
 update public.profiles p set role=set_user_access.role,is_active=set_user_access.is_active where p.id=user_id;
 if not found then raise exception '사용자를 찾을 수 없습니다'; end if;
end $$;

create function public.reserve_attachment(request_id uuid,original_name text,mime_type text,size_bytes integer) returns public.request_attachments language plpgsql security definer set search_path='' as $$
declare r public.requests; a public.request_attachments; aid uuid=gen_random_uuid(); ext text;
begin
 r=private.assert_writable(request_id);
 if (select count(*) from public.request_attachments q where q.request_id=reserve_attachment.request_id)>=5 then raise exception '이미지는 요청당 최대 5장입니다'; end if;
 ext=case mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end;
 insert into public.request_attachments(id,request_id,storage_path,original_name,mime_type,size_bytes,created_by)
 values(aid,r.id,r.customer_id::text||'/'||r.id::text||'/'||aid::text||'.'||ext,original_name,mime_type,size_bytes,auth.uid()) returning * into a;
 return a;
end $$;
create function public.finalize_attachment(id uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.request_attachments;
begin
 select * into a from public.request_attachments q where q.id=finalize_attachment.id;
 if a.id is null then raise exception '접근 권한이 없습니다'; end if; perform private.assert_writable(a.request_id);
 if a.created_by<>auth.uid() and not private.is_active_admin() then raise exception '접근 권한이 없습니다'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='request-images' and o.name=a.storage_path and (o.metadata->>'size')::bigint=a.size_bytes and o.metadata->>'mimetype'=a.mime_type) then raise exception '업로드 파일 확인이 필요합니다'; end if;
 update public.request_attachments q set state='ready' where q.id=a.id;
end $$;
create function public.remove_attachment_record(id uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.request_attachments;
begin
 select * into a from public.request_attachments q where q.id=remove_attachment_record.id;
 if a.id is null then raise exception '접근 권한이 없습니다'; end if; perform private.assert_writable(a.request_id);
 if a.created_by<>auth.uid() and not private.is_active_admin() then raise exception '접근 권한이 없습니다'; end if;
 if exists(select 1 from storage.objects o where o.bucket_id='request-images' and o.name=a.storage_path) then raise exception 'Storage 파일을 먼저 삭제하세요'; end if;
 delete from public.request_attachments q where q.id=a.id;
end $$;

-- Storage 정책은 자유 경로가 아닌 예약된 첨부 행에만 쓰기를 허용한다.
create function private.can_read_object(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.request_attachments a where a.storage_path=path and private.can_read_request(a.request_id))
$$;
create function private.can_write_object(path text,uploading boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.request_attachments a join public.requests r on r.id=a.request_id join public.customers c on c.id=r.customer_id
 where a.storage_path=path and private.can_access_customer(r.customer_id) and r.archived_at is null and c.is_active
 and (a.created_by=auth.uid() or private.is_active_admin()) and (not uploading or a.state='pending'))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('request-images','request-images',false,2097152,array['image/png','image/jpeg','image/webp']);
create policy tracker_image_read on storage.objects for select to authenticated using(bucket_id='request-images' and private.can_read_object(name));
create policy tracker_image_insert on storage.objects for insert to authenticated with check(bucket_id='request-images' and private.can_write_object(name,true));
create policy tracker_image_delete on storage.objects for delete to authenticated using(bucket_id='request-images' and private.can_write_object(name,false));

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_active_admin(),private.can_access_customer(uuid),private.can_read_request(uuid),private.can_read_object(text),private.can_write_object(text,boolean) to authenticated;
create function public.list_requests(filters jsonb default '{}',status_filter text default null,limit_count integer default 30,offset_count integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as materialized (
 select r.* from public.requests r join public.customers c on c.id=r.customer_id
 where (coalesce((filters->>'inactive')::boolean,false) or c.is_active)
 and ((r.archived_at is not null)=coalesce((filters->>'archived')::boolean,false))
 and (not coalesce((filters->>'archived')::boolean,false) or private.is_active_admin())
 and (nullif(filters->>'customer','') is null or r.customer_id=(filters->>'customer')::uuid)
 and (nullif(filters->>'author','') is null or r.created_by=(filters->>'author')::uuid)
 and (nullif(filters->>'from','') is null or r.requested_on>=(filters->>'from')::date)
 and (nullif(filters->>'to','') is null or r.requested_on<=(filters->>'to')::date)
 and (nullif(filters->>'search','') is null or position(lower(left(filters->>'search',200)) in lower(r.title||' '||r.description))>0)
 and case filters->>'deployment' when 'pending' then r.requires_deployment and r.test_deployed_at is not null and r.production_deployed_at is null
 when 'untested' then r.requires_deployment and r.test_deployed_at is null and r.production_deployed_at is null
 when 'production' then r.production_deployed_at is not null when 'unnecessary' then not r.requires_deployment else true end
 ), page as (
 select f.*, (select count(*)::int from public.request_attachments a where a.request_id=f.id and a.state='ready') as attachment_count
 from filtered f where status_filter is null or f.status=status_filter order by f.updated_at desc,f.number desc limit least(greatest(limit_count,1),100) offset greatest(offset_count,0)
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.number desc) from page p),'[]'::jsonb),
 'total',(select count(*) from filtered where status_filter is null or status=status_filter),
 'counts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from filtered group by status) x),'{}'::jsonb),
 'pending',(select count(*) from filtered where requires_deployment and test_deployed_at is not null and production_deployed_at is null))
$$;
-- 새 함수의 기본 PUBLIC EXECUTE를 제거한다. 이 마이그레이션이 정의한 공개 함수만 허용한다.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('list_requests','get_people','update_display_name','create_request','update_request','add_request_activity','set_request_archived','save_customer','set_customer_members','set_user_access','reserve_attachment','finalize_attachment','remove_attachment_record') loop
 execute format('revoke all on function %s from public, anon',f.sig); execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
commit;
