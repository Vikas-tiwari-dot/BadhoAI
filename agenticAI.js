require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');


// ── App Settings ────────────────────
// Yahan sari API keys aur basic settings hain.

const CONFIG = {
  ADZUNA_APP_ID:   process.env.ADZUNA_APP_ID   || '',
  ADZUNA_APP_KEY:  process.env.ADZUNA_APP_KEY  || '',
  JSEARCH_API_KEY: process.env.JSEARCH_API_KEY || '',
  ANTHROPIC_KEY:   process.env.ANTHROPIC_API_KEY || '',

  OUTPUT_DIR:    './Badho_output',
  MAX_RESULTS:   50,      
  REQUEST_DELAY: 1200, 
  AI_ENRICH:     true, 
};


// ── User Profile ──────────────────────────────────────────────────────────────
// Apni details yahan bharo — isi ke hisaab se jobs recommend hongi aur enrich hongi.

const USER_PROFILE = {
  degree:             'B.Tech',
  branch:             'Computer Science',
  graduationYear:     '2025',
  skills:             ['Python', 'JavaScript', 'React', 'SQL', 'Machine Learning'],
  preferredRoles:     ['Software Engineer', 'Data Analyst', 'Backend Developer', 'ML Engineer'],
  preferredLocations: ['Bangalore', 'Mumbai', 'Hyderabad', 'Pune', 'Delhi'],
  remotePreference:   'hybrid',    // remote | hybrid | onsite
  experienceLevel:    'fresher',   // fresher | junior | mid
  expectedSalary:     '4-8 LPA',
  careerInterests:    ['AI/ML', 'Web Development', 'Data Science'],
};


// ── Utility Functions ─────────────────────────────────────────────────────────

// Simple sleep — async loops mein delay ke liye kaam aata hai
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Console logs ko thoda acha dikhane ke liye
const log = {
  info:    (m) => console.log(`    ${m}`),
  success: (m) => console.log(`  ${m}`),
  warn:    (m) => console.log(`   ${m}`),
  error:   (m) => console.log(`   ${m}`),
  section: (m) => console.log(`\n${'─'.repeat(55)}\n  ${m}\n${'─'.repeat(55)}`),
};


// ── API 1: Adzuna ─────────────────────────────────────────────────────────────
// India ki full-time, part-time aur internship jobs fetch karta hai.
// Multiple categories mein search karega ek saath.

async function fetchAdzunaJobs(keyword, category = 'it-jobs') {
  if (!CONFIG.ADZUNA_APP_ID || !CONFIG.ADZUNA_APP_KEY) {
    log.warn('Adzuna keys missing');
    return [];
  }

  // In sab categories mein search karenge aur zyada variety ke liye — IT, engineering, science, freshers, part-time
  const categories = [
    'it-jobs', 'engineering-jobs', 'science-jobs',
    'graduate-jobs', 'part-time-jobs'
  ];

  const allJobs = [];

  for (const cat of categories) {
    try {
      const url = `https://api.adzuna.com/v1/api/jobs/in/search/1`;
      const res = await axios.get(url, {
        params: {
          app_id:           CONFIG.ADZUNA_APP_ID,
          app_key:          CONFIG.ADZUNA_APP_KEY,
          results_per_page: 20,
          what:             keyword,
          category:         cat,
          'content-type':   'application/json',  // hyphen chahiye, underscore nahi
          sort_by:          'date',              // naye jobs pehle
        },
        timeout: 15000,
      });

      // API response ko apne format mein convert karo
      const jobs = (res.data.results || []).map(j => ({
        id:           `adzuna_${j.id}`,
        jobTitle:     j.title || 'Not available',
        company:      j.company?.display_name || 'Not publicly available',
        location:     j.location?.display_name || 'India',
        salary:       j.salary_min && j.salary_max
                        ? `₹${Math.round(j.salary_min / 100000)}–${Math.round(j.salary_max / 100000)} LPA`
                        : 'Not publicly available',
        description:  (j.description || '').slice(0, 400),
        applyLink:    j.redirect_url || '',
        postingDate:  j.created || new Date().toISOString(),
        contractType: j.contract_type || '',
        contractTime: j.contract_time || '',
        category:     cat,
        source:       'Adzuna',
        sourceType:   'India Jobs',
        isExpired:    false,
        raw:          true,
      }));

      allJobs.push(...jobs);
      log.success(`Adzuna [${cat}] "${keyword}" → ${jobs.length} jobs`);
      await sleep(CONFIG.REQUEST_DELAY);

    } catch (err) {
      log.warn(`Adzuna [${cat}] error: ${err.response?.data?.error || err.message}`);
    }
  }

  return allJobs;
}


// ── API 2: JSearch (via RapidAPI) ────────────────────────────────────────────
// LinkedIn, Indeed aur Glassdoor ka data ek saath milega yahan.

async function fetchJSearchJobs(queries) {
  if (!CONFIG.JSEARCH_API_KEY) {
    log.warn('JSearch key missing — skipping. Get free: https://rapidapi.com → search "JSearch"');
    return [];
  }

  const allJobs = [];

  //user ke quer me faltu baketi daal du😂
  const searchQueries = [
    ...queries.map(q => `${q} jobs in India`),
    'internship India 2025',
    'fresher jobs India',
    'work from home jobs India',
    'remote software engineer India',
    'part time jobs India',
  ];

  for (const query of searchQueries) {
    try {
      const res = await axios.get('https://jsearch.p.rapidapi.com/search', {
        params: {
          query,
          page:             '1',
          num_pages:        '2',
          date_posted:      'month',  // sirf last 30 din
          employment_types: 'FULLTIME,PARTTIME,INTERN,CONTRACTOR',
        },
        headers: {
          'X-RapidAPI-Key':  CONFIG.JSEARCH_API_KEY,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
        timeout: 20000,
      });

      const jobs = (res.data.data || []).map(j => ({
        id:             `jsearch_${j.job_id}`,
        jobTitle:       j.job_title || 'Not available',
        company:        j.employer_name || 'Not publicly available',
        location:       j.job_city
                          ? `${j.job_city}, ${j.job_country || 'India'}`
                          : (j.job_country || 'India'),
        salary:         j.job_min_salary && j.job_max_salary
                          ? `${j.job_salary_currency || '₹'}${j.job_min_salary}–${j.job_max_salary} ${j.job_salary_period || ''}`
                          : 'Not publicly available',
        description:    (j.job_description || '').slice(0, 400),
        applyLink:      j.job_apply_link || '',
        postingDate:    j.job_posted_at_datetime_utc || new Date().toISOString(),
        employmentType: j.job_employment_type || '',
        isRemote:       j.job_is_remote || false,
        workMode:       j.job_is_remote ? 'Remote' : 'Onsite',
        companyLogo:    j.employer_logo || '',
        jobProvider:    j.job_publisher || 'JSearch',
        source:         'JSearch (LinkedIn/Indeed)',
        sourceType:     'LinkedIn + Indeed',
        isExpired:      false,
        raw:            true,
      }));

      allJobs.push(...jobs);
      log.success(`JSearch "${query}" → ${jobs.length} jobs`);
      await sleep(CONFIG.REQUEST_DELAY);

    } catch (err) {
      if (err.response?.status === 429) {
        // Rate limit aaya — thoda aaram kr lo guru jaldi kyu hai

        log.warn('JSearch rate limit hit — waiting 5s...');
        await sleep(5000);
      } else {
        log.warn(`JSearch error: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  return allJobs;
}


// ── API 3: Remotive ───────────────────────────────────────────────────────────
// Purely remote/WFH jobs ke liye

async function fetchRemotiveJobs() {
  const categories = [
    'software-dev', 'data', 'devops', 'design',
    'marketing', 'business', 'finance', 'product',
    'all-other',
  ];

  const allJobs = [];

  for (const cat of categories) {
    try {
      const res = await axios.get('https://remotive.com/api/remote-jobs', {
        params: {
          category: cat,
          limit:    30,
        },
        timeout: 15000,
      });

      const now    = Date.now();
      const cutoff = 30 * 24 * 60 * 60 * 1000; // 30 din ka cutoff

      const jobs = (res.data.jobs || [])
        .filter(j => {
          // Sirf last 30 din ke jobs rakhenge
          const posted = new Date(j.publication_date).getTime();
          return (now - posted) < cutoff;
        })
        .map(j => ({
          id:          `remotive_${j.id}`,
          jobTitle:    j.title || 'Not available',
          company:     j.company_name || 'Not publicly available',
          location:    j.candidate_required_location || 'Worldwide (Remote)',
          salary:      j.salary || 'Not publicly available',
          description: (j.description || '').replace(/<[^>]+>/g, '').slice(0, 400),
          applyLink:   j.url || '',
          postingDate: j.publication_date || new Date().toISOString(),
          tags:        j.tags || [],
          workMode:    'Remote',
          jobType:     'Remote',
          companyLogo: j.company_logo || '',
          source:      'Remotive',
          sourceType:  'Remote Jobs',
          isExpired:   false,
          raw:         true,
        }));

      allJobs.push(...jobs);
      log.success(`Remotive [${cat}] → ${jobs.length} recent remote jobs`);
      await sleep(800);

    } catch (err) {
      log.warn(`Remotive [${cat}] error: ${err.message}`);
    }
  }

  return allJobs;
}


// ── API 4: Arbeitnow ─────────────────────────
// Remote jobs aur internships globally 

async function fetchArbeitnowJobs() {
  const allJobs = [];

  try {
    // 3 pages fetch karenge zyada results ke liye
    for (let page = 1; page <= 3; page++) {
      const res = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
        params: { page },
        timeout: 15000,
      });

      const jobs = (res.data.data || [])
        .filter(j => j.remote || j.tags?.includes('intern'))  // sirf remote ya intern jobs
        .map(j => ({
          id:          `arbeitnow_${j.slug}`,
          jobTitle:    j.title || 'Not available',
          company:     j.company_name || 'Not publicly available',
          location:    j.location || 'Remote',
          salary:      'Not publicly available',
          description: (j.description || '').replace(/<[^>]+>/g, '').slice(0, 400),
          applyLink:   j.url || '',
          postingDate: new Date(j.created_at * 1000).toISOString(),
          tags:        j.tags || [],
          workMode:    j.remote ? 'Remote' : 'Onsite',
          jobType:     j.job_types?.includes('internship') ? 'Internship' : 'Full-Time',
          source:      'Arbeitnow',
          sourceType:  'Remote + Internships',
          isExpired:   false,
          raw:         true,
        }));

      allJobs.push(...jobs);
      log.success(`Arbeitnow [page ${page}] → ${jobs.length} jobs`);
      await sleep(800);
    }
  } catch (err) {
    log.warn(`Arbeitnow error: ${err.message}`);
  }

  return allJobs;
}


// ── API 5: Internshala ────────────────────────────────────────────────────────
// Internshala ke structured data (JSON-LD) se internships extract karta hai.
// Iske liye koi API key nahi chahiye — public page se data nikalta hai.

async function fetchInternshalaPublic() {
  const allJobs = [];
  const keywords = ['computer science', 'web development', 'data science', 'python', 'machine learning'];

  for (const kw of keywords) {
    try {
      const res = await axios.get(
        `https://internshala.com/internships/keywords-${encodeURIComponent(kw)}`,
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':     'text/html',
          },
        }
      );

      // Page ke andar JSON-LD structured data dhundho
      const matches = res.data.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];

      for (const block of matches) {
        try {
          const json = JSON.parse(
            block.replace(/<script[^>]*>/, '').replace('</script>', '').trim()
          );

          if (json['@type'] === 'JobPosting' || Array.isArray(json)) {
            const items = Array.isArray(json) ? json : [json];

            for (const item of items) {
              if (item['@type'] === 'JobPosting') {
                allJobs.push({
                  id:          `internshala_${Math.random().toString(36).slice(2)}`,
                  jobTitle:    item.title || 'Internship',
                  company:     item.hiringOrganization?.name || 'Not publicly available',
                  location:    item.jobLocation?.address?.addressLocality || 'India',
                  salary:      item.baseSalary?.value?.value
                                 ? `₹${item.baseSalary.value.value} ${item.baseSalary.value.unitText || ''}`
                                 : 'Not publicly available',
                  description: (item.description || '').replace(/<[^>]+>/g, '').slice(0, 400),
                  applyLink:   item.url || 'https://internshala.com/internships',
                  postingDate: item.datePosted || new Date().toISOString(),
                  deadline:    item.validThrough || 'Not publicly available',
                  jobType:     'Internship',
                  workMode:    item.jobLocationType === 'TELECOMMUTE' ? 'Remote' : 'Onsite',
                  source:      'Internshala',
                  sourceType:  'Internship',
                  isExpired:   false,
                  raw:         true,
                });
              }
            }
          }
        } catch (_) {
          // Agar koi ek block parse nahi hua, skip karo — baaki ka continue karo
        }
      }

      log.success(`Internshala "${kw}" → ${allJobs.length} structured jobs found`);
      await sleep(1500);

    } catch (err) {
      log.warn(`Internshala "${kw}": ${err.message}`);
    }
  }

  return allJobs;
}


// ── Deduplication ─────────────────────────────────────────────────────────────
// Same job title + company wali duplicate entries hata deta hai.

function deduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const key = `${(j.jobTitle || '').toLowerCase().slice(0, 40)}__${(j.company || '').toLowerCase().slice(0, 30)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// ── Scam Filter ───────────────────────────────────────────────────────────────
// Fraud ya spam jobs ko filter karta hai in keywords ki madad se.

const SCAM_WORDS = [
  'pay to apply', 'registration fee', 'deposit required',
  'mlm', 'multi-level', 'guaranteed income', 'earn unlimited',
  '100% job guarantee', 'no experience unlimited',
];

function isScam(job) {
  const text = `${job.jobTitle} ${job.description} ${job.company}`.toLowerCase();
  return SCAM_WORDS.some(w => text.includes(w));
}


// ── Claude AI Enrichment ──────────
// Jobs ko Claude se analyze karwata hai — ranking, skills, eligibility etc. add karta hai.
// Agar Claude key nahi hai ya AI_ENRICH = false hai, toh fallback classifiers use hote hain.

async function enrichWithClaude(jobs, batchSize = 8) {
  if (!CONFIG.ANTHROPIC_KEY || !CONFIG.AI_ENRICH) {
    log.warn('Claude enrichment skipped — assigning default scores');

    // Claude nahi hai toh local functions se hi kaam chalao
    return jobs.map((j, i) => ({
      ...j,
      jobType:            detectJobType(j),
      workMode:           j.workMode || detectWorkMode(j),
      skillsRequired:     extractSkills(j),
      eligibility:        detectEligibility(j),
      verificationStatus: 'Likely Verified',
      recruiterHR:        'Not publicly available',
      companySummary:     j.description?.slice(0, 200) || 'Not publicly available',
      whyRecommended:     `Matches your profile – from ${j.source}`,
      rankingScore:       60 + (i < 10 ? 20 : i < 20 ? 10 : 0),
      enrichedAt:         new Date().toISOString(),
    }));
  }

  const enriched = [];

  // Sab jobs ko chhote-chhote batches mein divide karo
  const batches = [];
  for (let i = 0; i < jobs.length; i += batchSize) {
    batches.push(jobs.slice(i, i + batchSize));
  }

  log.info(`Enriching ${jobs.length} jobs in ${batches.length} batches via Claude...`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    log.info(`  Batch ${b + 1}/${batches.length} (${batch.length} jobs)...`);

    // Claude ko system context do — user profile ke saath
    const systemPrompt = `You are Badho AI. Enrich raw job data for Indian job seekers.

User Profile:
- Degree: ${USER_PROFILE.degree} in ${USER_PROFILE.branch} (${USER_PROFILE.graduationYear})
- Skills: ${USER_PROFILE.skills.join(', ')}
- Experience: ${USER_PROFILE.experienceLevel}
- Preferred Roles: ${USER_PROFILE.preferredRoles.join(', ')}
- Preferred Locations: ${USER_PROFILE.preferredLocations.join(', ')}
- Remote Preference: ${USER_PROFILE.remotePreference}
- Expected Salary: ${USER_PROFILE.expectedSalary}

Rules:
- NEVER change jobTitle, company, applyLink, postingDate — these are REAL verified data
- NEVER fabricate recruiterHR, personal emails, or phone numbers
- recruiterHR MUST always be "Not publicly available"
- Only enrich/improve: jobType, workMode, skillsRequired, eligibility, verificationStatus, companySummary, whyRecommended, rankingScore
- rankingScore 1-100: freshness(20) + source(15) + company(15) + fresher-friendly(15) + salary(10) + remote(10) + skill-match(10) + growth(5)
- verificationStatus: "Verified" (official source) | "Likely Verified" | "Needs Verification"

Respond ONLY with valid JSON array. No markdown, no explanation.`;

    const userMsg = `Enrich these ${batch.length} REAL jobs:\n${JSON.stringify(
      batch.map(j => ({
        id:           j.id,
        jobTitle:     j.jobTitle,
        company:      j.company,
        location:     j.location,
        salary:       j.salary,
        description:  j.description?.slice(0, 200),
        source:       j.source,
        workMode:     j.workMode || '',
        postingDate:  j.postingDate,
        applyLink:    j.applyLink,
        contractType: j.contractType || '',
        tags:         j.tags || [],
      })), null, 2
    )}\n\nReturn JSON array with fields: id, jobType, workMode, skillsRequired (array), eligibility, verificationStatus, companySummary, industry, companySize, whyRecommended, rankingScore`;

    try {
      const res = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 4096,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userMsg }],
        },
        {
          headers: {
            'x-api-key':         CONFIG.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          timeout: 60000,
        }
      );

      // Claude ka response parse karo
      const text    = res.data.content?.[0]?.text || '[]';
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed  = JSON.parse(cleaned);

      // id ke basis pe ek map bana lo — easy lookup ke liye
      const enrichMap = {};
      for (const e of (Array.isArray(parsed) ? parsed : [])) {
        enrichMap[e.id] = e;
      }

      // Original job data + Claude ka enriched data merge karo
      for (const job of batch) {
        const e = enrichMap[job.id] || {};
        enriched.push({
          ...job,
          jobType:            e.jobType            || detectJobType(job),
          workMode:           e.workMode           || job.workMode || detectWorkMode(job),
          skillsRequired:     e.skillsRequired     || extractSkills(job),
          eligibility:        e.eligibility        || 'Open to freshers',
          verificationStatus: e.verificationStatus || 'Likely Verified',
          recruiterHR:        'Not publicly available',  // kabhi bhi change mat karo
          companySummary:     e.companySummary     || job.description?.slice(0, 200) || 'Not publicly available',
          industry:           e.industry           || 'Technology',
          companySize:        e.companySize        || 'Not publicly available',
          whyRecommended:     e.whyRecommended     || `From ${job.source} – matches your skills`,
          rankingScore:       Math.min(100, Math.max(1, Number(e.rankingScore) || 55)),
          enrichedAt:         new Date().toISOString(),
          raw:                false,
        });
      }

      log.success(`  Batch ${b + 1} enriched ✓`);

    } catch (err) {
      // Claude fail kiya — fallback se kaam chalao, skip mat karo
      log.warn(`  Batch ${b + 1} Claude error: ${err.message} — using fallback`);

      for (const job of batch) {
        enriched.push({
          ...job,
          jobType:            detectJobType(job),
          workMode:           job.workMode || detectWorkMode(job),
          skillsRequired:     extractSkills(job),
          eligibility:        'Open to freshers',
          verificationStatus: 'Likely Verified',
          recruiterHR:        'Not publicly available',
          companySummary:     job.description?.slice(0, 200) || 'Not publicly available',
          industry:           'Technology',
          companySize:        'Not publicly available',
          whyRecommended:     `From ${job.source} – real verified listing`,
          rankingScore:       55,
          enrichedAt:         new Date().toISOString(),
          raw:                false,
        });
      }
    }

    await sleep(1000);
  }

  return enriched;
}


// ── Fallback Classifiers ──────────────────────────────────────────────────────
// Yeh tab kaam aate hain jab Claude available nahi hota.
// Job title aur description se hi type, mode aur skills detect karte hain.

function detectJobType(job) {
  const text = `${job.jobTitle} ${job.description} ${job.contractType} ${job.employmentType} ${(job.tags || []).join(' ')}`.toLowerCase();
  if (text.includes('intern'))                                          return 'Internship';
  if (text.includes('part-time') || text.includes('part time'))        return 'Part-Time';
  if (text.includes('contract'))                                        return 'Contract';
  if (text.includes('freelance'))                                       return 'Freelance';
  if (text.includes('trainee') || text.includes('graduate'))           return 'Graduate Trainee';
  return 'Full-Time';
}

function detectWorkMode(job) {
  const text = `${job.jobTitle} ${job.description} ${job.location} ${(job.tags || []).join(' ')}`.toLowerCase();
  if (job.isRemote || text.includes('remote') || text.includes('work from home') || text.includes('wfh')) return 'Remote';
  if (text.includes('hybrid')) return 'Hybrid';
  return 'Onsite';
}

function extractSkills(job) {
  const text = `${job.jobTitle} ${job.description}`.toLowerCase();
  const skillsList = [
    'python', 'javascript', 'typescript', 'react', 'node.js', 'nodejs', 'java', 'c++', 'c#',
    'sql', 'mongodb', 'postgresql', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git',
    'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'data analysis',
    'excel', 'power bi', 'tableau', 'html', 'css', 'php', 'django', 'flask', 'spring',
    'android', 'ios', 'flutter', 'react native', 'devops', 'linux', 'bash',
    'figma', 'photoshop', 'communication', 'leadership', 'ms office',
  ];
  return skillsList.filter(s => text.includes(s)).slice(0, 8);
}

function detectEligibility(job) {
  const text = `${job.description} ${job.jobTitle}`.toLowerCase();
  if (text.includes('fresher') || text.includes('0 year') || text.includes('entry level')) return 'Freshers welcome';
  if (text.includes('intern'))                                                               return 'Students / Freshers';
  if (text.includes('1 year') || text.includes('1+ year'))                                 return '1+ year experience';
  if (text.includes('2 year') || text.includes('2+ year'))                                 return '2+ years experience';
  return 'As per job description';
}


// ── Daily Digest Builder ──────────────────────────────────────────────────────
// Enriched jobs ko categories mein baant ke ek final digest object banata hai.

function buildDigest(jobs) {
  // Ranking score ke hisaab se sort karo — best jobs pehle
  const sorted = [...jobs].sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0));

  const internships  = sorted.filter(j => j.jobType === 'Internship').slice(0, 20);
  const fresherJobs  = sorted.filter(j =>
    j.jobType !== 'Internship' &&
    (j.eligibility?.toLowerCase().includes('fresh') || j.rankingScore >= 55)
  ).slice(0, 20);
  const remoteJobs   = sorted.filter(j => j.workMode === 'Remote').slice(0, 20);
  const wfhJobs      = sorted.filter(j => j.workMode === 'Remote' || j.workMode === 'Hybrid').slice(0, 20);
  const partTimeJobs = sorted.filter(j => j.jobType === 'Part-Time').slice(0, 20);
  const fullTimeJobs = sorted.filter(j => j.jobType === 'Full-Time').slice(0, 20);

  // Har job se skills count karo — trending skills nikalne ke liye
  const skillCount = {};
  for (const job of sorted) {
    for (const s of (job.skillsRequired || [])) {
      skillCount[s] = (skillCount[s] || 0) + 1;
    }
  }
  const trendingSkills = Object.entries(skillCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([skill, count]) => ({ skill, jobCount: count }));

  // Top hiring companies — jinke paas zyada openings hain
  const companyCount = {};
  for (const job of sorted) {
    if (job.company && job.company !== 'Not publicly available') {
      companyCount[job.company] = (companyCount[job.company] || 0) + 1;
    }
  }
  const topCompanies = Object.entries(companyCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([company, openings]) => ({ company, openings }));

  // Kitne jobs kahan se aaye — source breakdown
  const sourceCount = {};
  for (const job of sorted) {
    sourceCount[job.source] = (sourceCount[job.source] || 0) + 1;
  }

  return {
    meta: {
      title:       'Badho AI – Daily Real Jobs Digest',
      generatedAt: new Date().toISOString(),
      version:     '2.0.0',
      dataSource:  'Adzuna API + JSearch (LinkedIn/Indeed) + Remotive + Arbeitnow + Internshala',
      isRealData:  true,
      note:        'All jobs are real, currently available listings fetched from live APIs',
    },
    summary: {
      totalJobsFetched: jobs.length,
      totalAfterFilter: sorted.length,
      internships:      internships.length,
      fresherJobs:      fresherJobs.length,
      remoteJobs:       remoteJobs.length,
      wfhHybridJobs:    wfhJobs.length,
      partTimeJobs:     partTimeJobs.length,
      fullTimeJobs:     fullTimeJobs.length,
      sourceBreakdown:  sourceCount,
    },
    sections: {
      top20Internships:   internships,
      top20FresherJobs:   fresherJobs,
      top20RemoteJobs:    remoteJobs,
      top20WFHHybridJobs: wfhJobs,
      top20PartTimeJobs:  partTimeJobs,
      top20FullTimeJobs:  fullTimeJobs,
    },
    insights: {
      trendingSkills,
      topHiringCompanies: topCompanies,
    },
    allJobs: sorted,
  };
}


// ── Output Save ───────────────────────────────────────────────────────────────
// Digest ko JSON files mein save karta hai — ek timestamp wala, ek latest.json.
// Alag-alag category files bhi banta hai jaise internships.json, remote.json etc.

function saveOutput(digest) {
  // Output folder nahi hai toh bana do
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }

  const ts         = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fullPath   = path.join(CONFIG.OUTPUT_DIR, `digest_${ts}.json`);
  const latestPath = path.join(CONFIG.OUTPUT_DIR, 'latest.json');

  fs.writeFileSync(fullPath,   JSON.stringify(digest, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(digest, null, 2));

  log.success(`Saved: ${fullPath}`);
  log.success(`Latest: ${latestPath}`);

  // Category-wise alag files bhi save karo
  const cats = {
    internships: digest.sections.top20Internships,
    fresher:     digest.sections.top20FresherJobs,
    remote:      digest.sections.top20RemoteJobs,
    wfh:         digest.sections.top20WFHHybridJobs,
    parttime:    digest.sections.top20PartTimeJobs,
    fulltime:    digest.sections.top20FullTimeJobs,
  };

  for (const [cat, jobs] of Object.entries(cats)) {
    const p = path.join(CONFIG.OUTPUT_DIR, `${cat}.json`);
    fs.writeFileSync(p, JSON.stringify({ category: cat, count: jobs.length, jobs }, null, 2));
    log.success(`  → ${cat}.json (${jobs.length} jobs)`);
  }

  return fullPath;
}


// ── Main Function ─────────────────────────────────────────────────────────────
// Yeh poora process run karta hai step by step:
// 1) APIs se jobs fetch karo
// 2) Clean + deduplicate karo
// 3) Claude se enrich karo
// 4) Digest banao
// 5) Files mein save karo

async function runBadhoAI() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║        Badho AI – REAL JOBS EDITION              ║');
  console.log('║        Fetching live data from real APIs...          ║');
  console.log(`║        ${new Date().toLocaleString('en-IN')}                    ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const allRaw = [];

  // ── Step 1: Sab APIs se jobs fetch karo ──────────────────────────────────
  log.section('STEP 1 — Fetching Real Jobs from APIs');

  // Adzuna — India jobs
  log.info('Calling Adzuna API (India jobs)...');
  for (const skill of USER_PROFILE.skills.slice(0, 3)) {
    const jobs = await fetchAdzunaJobs(skill);
    allRaw.push(...jobs);
  }

  // JSearch — LinkedIn + Indeed data
  log.info('Calling JSearch API (LinkedIn + Indeed data)...');
  const jsearchJobs = await fetchJSearchJobs(USER_PROFILE.preferredRoles.slice(0, 3));
  allRaw.push(...jsearchJobs);

  // Remotive — free remote jobs
  log.info('Calling Remotive API (free remote jobs)...');
  const remotiveJobs = await fetchRemotiveJobs();
  allRaw.push(...remotiveJobs);

  // Arbeitnow — free remote + internship jobs
  log.info('Calling Arbeitnow API (free remote + internships)...');
  const arbeitnowJobs = await fetchArbeitnowJobs();
  allRaw.push(...arbeitnowJobs);

  // Internshala — India internships
  log.info('Fetching Internshala structured data...');
  const internshalaJobs = await fetchInternshalaPublic();
  allRaw.push(...internshalaJobs);

  // ── Step 2: Duplicate aur scam jobs hato ─────────────────────────────────
  log.section('STEP 2 — Cleaning & Deduplicating');
  log.info(`Total raw jobs fetched: ${allRaw.length}`);

  const cleaned = deduplicate(allRaw.filter(j => !isScam(j) && !j.isExpired));
  log.success(`After dedup + scam filter: ${cleaned.length} jobs`);

  // ── Step 3: Claude se AI enrichment ──────────────────────────────────────
  log.section('STEP 3 — Claude AI Enrichment & Ranking');
  const enriched = await enrichWithClaude(cleaned);

  // ── Step 4: Digest banao ──────────────────────────────────────────────────
  log.section('STEP 4 — Building Daily Digest');
  const digest = buildDigest(enriched);

  // ── Step 5: Files mein save karo ─────────────────────────────────────────
  log.section('STEP 5 — Saving Output Files');
  const savedPath = saveOutput(digest);

  // ── Final Summary ─────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                  ✅ RUN COMPLETE                    ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total Real Jobs Found  : ${String(digest.summary.totalAfterFilter).padEnd(25)}║`);
  console.log(`║  Internships            : ${String(digest.summary.internships).padEnd(25)}║`);
  console.log(`║  Fresher Jobs           : ${String(digest.summary.fresherJobs).padEnd(25)}║`);
  console.log(`║  Remote Jobs            : ${String(digest.summary.remoteJobs).padEnd(25)}║`);
  console.log(`║  WFH / Hybrid           : ${String(digest.summary.wfhHybridJobs).padEnd(25)}║`);
  console.log(`║  Part-Time              : ${String(digest.summary.partTimeJobs).padEnd(25)}║`);
  console.log(`║  Full-Time              : ${String(digest.summary.fullTimeJobs).padEnd(25)}║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Output Folder: ./Badho_output/                  ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  return digest;
}


// ── Express Server (Optional) ─────────────────────────────────────────────────
// Agar --server flag de ke run karo toh yeh HTTP API bhi shuru ho jaata hai.
// Frontend ya koi bhi app /jobs endpoints se data fetch kar sakta hai.

async function startServer() {
  const express = require('express');
  const app     = express();
  app.use(express.json());

  // CORS — sab origins se requests allow karo
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });

  let cache   = null;   // last fetch ka data
  let lastRun = null;   // last fetch ka time
  let running = false;  // abhi fetch chal rahi hai ya nahi

  // Startup pe agar pehle ka data hai toh load kar lo
  const loadLatest = () => {
    try {
      const p = path.join(CONFIG.OUTPUT_DIR, 'latest.json');
      if (fs.existsSync(p)) {
        cache   = JSON.parse(fs.readFileSync(p, 'utf8'));
        lastRun = cache.meta?.generatedAt;
      }
    } catch (_) {}
  };
  loadLatest();

  // Root route — server info aur available routes dikhata hai
  app.get('/', (_, res) => res.json({
    service: 'Badho AI – Real Jobs API',
    version: '2.0.0',
    routes: {
      'GET /jobs':             'All jobs (sorted by score)',
      'GET /jobs/internships': 'Top internships',
      'GET /jobs/fresher':     'Fresher jobs',
      'GET /jobs/remote':      'Remote jobs',
      'GET /jobs/wfh':         'WFH + Hybrid jobs',
      'GET /jobs/parttime':    'Part-time jobs',
      'GET /jobs/fulltime':    'Full-time jobs',
      'GET /jobs/skills':      'Trending skills',
      'POST /jobs/refresh':    'Trigger new fetch (runs in background)',
    },
    lastRun,
    totalJobs: cache?.summary?.totalAfterFilter || 0,
  }));

  // Ek helper function — different categories ke liye ek jaisa route handler
  const getJobs = (key) => (_, res) => {
    if (!cache) return res.status(404).json({ error: 'No data yet. POST /jobs/refresh first.' });
    const data = key === 'all' ? cache.allJobs : cache.sections?.[key] || [];
    res.json({ count: data.length, lastRun, jobs: data });
  };

  // Jobs routes
  app.get('/jobs',             getJobs('all'));
  app.get('/jobs/internships', getJobs('top20Internships'));
  app.get('/jobs/fresher',     getJobs('top20FresherJobs'));
  app.get('/jobs/remote',      getJobs('top20RemoteJobs'));
  app.get('/jobs/wfh',         getJobs('top20WFHHybridJobs'));
  app.get('/jobs/parttime',    getJobs('top20PartTimeJobs'));
  app.get('/jobs/fulltime',    getJobs('top20FullTimeJobs'));

  app.get('/jobs/skills', (_, res) => {
    if (!cache) return res.status(404).json({ error: 'No data yet.' });
    res.json(cache.insights?.trendingSkills || []);
  });

  // Refresh route — background mein naya fetch shuru karo
  app.post('/jobs/refresh', (_, res) => {
    if (running) return res.json({ message: 'Already running...', lastRun });
    running = true;
    res.json({ message: 'Fetch started in background. Check /jobs in ~2 min.' });
    runBadhoAI()
      .then(d => { cache = d; lastRun = d.meta.generatedAt; running = false; })
      .catch(e => { log.error(e.message); running = false; });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    log.section('Badho AI Server Running');
    log.success(`http://localhost:${PORT}`);
    log.info('GET /jobs/internships  → real internships');
    log.info('GET /jobs/remote       → remote jobs');
    log.info('GET /jobs/fresher      → fresher jobs');
    log.info('POST /jobs/refresh     → fetch new jobs');
  });
}


// ── Entry Point ───────────────────────────────────────────────────────────────
// node agenticAI.js          → seedha jobs fetch karo
// node agenticAI.js --server → HTTP server start karo

if (process.argv.includes('--server')) {
  startServer();
} else {
  runBadhoAI().catch(console.error);
}

module.exports = { runBadhoAI, USER_PROFILE, CONFIG };