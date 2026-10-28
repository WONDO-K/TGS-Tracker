import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Customer, Person, Profile } from '../lib/types';
import { demo, supabase } from '../lib/supabase';
import { getCustomers, getPeople } from '../lib/api';
import { errorMessage } from '../lib/domain';
interface State{profile:Profile|null;customers:Customer[];people:Person[];loading:boolean;error:string;reload:()=>Promise<void>;}
const Context=createContext<State>(null!);
export function SessionProvider({children}:{children:ReactNode}){
 const [profile,setProfile]=useState<Profile|null>(null),[customers,setCustomers]=useState<Customer[]>([]),[people,setPeople]=useState<Person[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const reload=useCallback(async()=>{
 try{setError('');if(demo){setProfile({id:'demo',display_name:'포트폴리오 방문자',email:'',role:'member',is_active:true});setCustomers(await getCustomers());setPeople(await getPeople());return;}
 if(!supabase)return;const {data,error}=await supabase.auth.getUser();if(error){if(error.name==='AuthSessionMissingError'){setProfile(null);return;}throw error;}
 if(!data.user){setProfile(null);return;}const result=await supabase.from('profiles').select('*').eq('id',data.user.id).single();if(result.error)throw result.error;
 setProfile(result.data);if(result.data.is_active){const [c,p]=await Promise.all([getCustomers(),getPeople()]);setCustomers(c);setPeople(p);}else{setCustomers([]);setPeople([]);}
 }catch(e){setError(errorMessage(e));}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void reload();const {data}=supabase?.auth.onAuthStateChange(()=>{setTimeout(()=>void reload(),0);})??{data:null};
 const visible=()=>{if(document.visibilityState==='visible')void reload();};document.addEventListener('visibilitychange',visible);
 return()=>{data?.subscription.unsubscribe();document.removeEventListener('visibilitychange',visible);};},[reload]);
 return <Context.Provider value={{profile,customers,people,loading,error,reload}}>{children}</Context.Provider>;
}
export const useSession=()=>useContext(Context);
