begin;

-- Edge Functions enforce both TGS membership and the caller's GitHub access.
-- No browser role may read credentials, OAuth state, or correspondence records.
create table public.github_connections (
 user_id uuid primary key references public.profiles(id),
 generation uuid not null default gen_random_uuid(),
 token_ciphertext text,
 github_user_id bigint,
 login text,
 scopes text,
 expires_at timestamptz,
 connected_at timestamptz
);

create table public.github_oauth_states (
 state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid not null unique references public.profiles(id),
 generation uuid not null,
 code_verifier text not null,
 code_ciphertext text,
 return_url text not null,
 expires_at timestamptz not null
);
create index on public.github_oauth_states(expires_at);

create table public.github_repositories (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 github_id bigint not null,
 full_name text not null check(full_name ~ '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$'),
 default_branch text not null default 'main',
 is_active boolean not null default true,
 created_by uuid not null references public.profiles(id),
 unique(customer_id,github_id)
);

create table public.github_commit_links (
 repository_id uuid not null references public.github_repositories(id),
 base_branch text not null check(length(base_branch) between 1 and 250 and length(trim(base_branch))>0),
 target_branch text not null check(length(target_branch) between 1 and 250 and length(trim(target_branch))>0),
 source_sha text not null check(source_sha ~ '^[0-9a-f]{40}$'),
 target_sha text not null check(target_sha ~ '^[0-9a-f]{40}$'),
 confirmed_by uuid not null references public.profiles(id),
 confirmed_at timestamptz not null default now(),
 primary key(repository_id,base_branch,target_branch,source_sha),
 check(base_branch<>target_branch)
);

alter table public.github_connections enable row level security;
alter table public.github_oauth_states enable row level security;
alter table public.github_repositories enable row level security;
alter table public.github_commit_links enable row level security;
revoke all on public.github_connections,public.github_oauth_states,public.github_repositories,public.github_commit_links from public,anon,authenticated;
grant select,insert,update,delete on public.github_connections,public.github_oauth_states,public.github_repositories,public.github_commit_links to service_role;

create function public.github_begin_oauth(uid uuid,gen uuid,hash text,verifier text,return_to text,expires timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Upsert locks the connection before touching state, as disconnect does.
 -- Reconnecting retains the current credentials until a callback succeeds.
 insert into public.github_connections(user_id,generation) values(uid,gen)
 on conflict(user_id) do update set generation=excluded.generation;
 delete from public.github_oauth_states where user_id=uid;
 delete from public.github_oauth_states where expires_at<=now();
 insert into public.github_oauth_states(state_hash,user_id,generation,code_verifier,return_url,expires_at)
 values(hash,uid,gen,verifier,return_to,expires);
end $$;

create function public.github_stage_oauth(uid uuid,gen uuid,hash text,verifier text,return_to text,expires timestamptz,code text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 -- Lock the same row as begin/end before storing the callback's encrypted code.
 -- An older generation must never replace a newer pending authorization.
 perform 1 from public.github_connections where user_id=uid and generation=gen for update;
 if not found then return false; end if;
 delete from public.github_oauth_states where user_id=uid and generation=gen;
 insert into public.github_oauth_states(state_hash,user_id,generation,code_verifier,return_url,expires_at,code_ciphertext)
 values(hash,uid,gen,verifier,return_to,expires,code);
 return true;
end $$;

create function public.github_end_connection(uid uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Keep the row and advance generation so an in-flight callback's conditional
 -- UPDATE cannot restore disconnected credentials. Callback must never upsert.
 update public.github_connections set generation=gen_random_uuid(),
 token_ciphertext=null,github_user_id=null,login=null,scopes=null,expires_at=null,connected_at=null
 where user_id=uid;
 delete from public.github_oauth_states where user_id=uid;
end $$;

revoke all on function public.github_begin_oauth(uuid,uuid,text,text,text,timestamptz),public.github_stage_oauth(uuid,uuid,text,text,text,timestamptz,text),public.github_end_connection(uuid) from public,anon,authenticated;
grant execute on function public.github_begin_oauth(uuid,uuid,text,text,text,timestamptz),public.github_stage_oauth(uuid,uuid,text,text,text,timestamptz,text),public.github_end_connection(uuid) to service_role;

commit;
