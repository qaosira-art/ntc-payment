const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pshkcdjluvgtuawqumio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzaGtjZGpsdXZndHVhd3F1bWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDk4OTYsImV4cCI6MjA5NTMyNTg5Nn0.xOizPzboTNtAEYYfdoR1qhMV58USapPUxgcKjMo4Naw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
    try {
        console.log("Fetching student list...");
        const { data, error } = await supabase.from('students').select('*').limit(1);
        if (error) {
            console.error("Fetch error:", error);
        } else {
            console.log("Fetch success. Sample student record:", data);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}

test();
