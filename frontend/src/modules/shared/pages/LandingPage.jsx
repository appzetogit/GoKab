import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Clock, Gift, Map, Car, Phone, Mail, LogIn } from 'lucide-react';
import './LandingPage.css';
import { useSettings } from '../../../shared/context/SettingsContext';

// Using the existing project images
import heroImg from '@/assets/landing/hero.png';
import rideImg from '@/assets/landing/ride.png';
import heroBgImg from '@/assets/landing/hero-bg.png';
import newHeroTaxiImg from '@/assets/ride-removebg-preview.png';
// import checkUsOutImg from '@/assets/check_us_out.jpg';
import { Camera, PlayCircle, Share2, Download } from 'lucide-react';

function LandingPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'gokab';
  const [activeTab, setActiveTab] = React.useState('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const appLinks = [
    {
      label: 'User App',
      href: 'https://play.google.com/store/apps/details?id=com.gokab.user',
    },
    {
      label: 'Driver App',
      href: 'https://play.google.com/store/apps/details?id=com.gokab.driver',
    },
  ];

  // Custom logo rendering to match 'gokab' style (first part green, second part white)
  const renderLogo = () => {
    const nameStr = appName.toString();
    if (nameStr.toLowerCase() === 'gokab' || nameStr.length > 4) {
      const mid = Math.floor(nameStr.length / 2);
      return (
        <>
          {nameStr.substring(0, mid)}
          <span className="text-white">{nameStr.substring(mid)}</span>
        </>
      );
    }
    return nameStr;
  };

  const handleRedirect = (path, tabName) => (e) => {
    e?.preventDefault();
    if (tabName) setActiveTab(tabName);
    setIsMobileMenuOpen(false);
    if (path.startsWith('#')) {
      const element = document.querySelector(path);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      navigate(path);
    }
  };

  return (
    <div className="landing-page">
      {/* New Header & Hero Wrapper */}
      <div className="new-hero-wrapper">
        <div className="new-hero-background" style={{ backgroundImage: `url(${heroBgImg})` }}></div>

        {/* Top Info Bar */}
        <div className="new-top-bar">
          <div className="new-logo-container">
            <a href="/" className="new-logo">
              <span style={{ color: 'var(--dark-text-premium)' }}>Gokab</span>
            </a>
          </div>
          <div className="new-top-contacts">
            <div className="top-contact-item">
              <Phone size={16} />
              <span>7409129517</span>
            </div>
            <div className="top-contact-item">
              <Mail size={16} />
              <span>supportgokab@gmail.com</span>
            </div>
          </div>
        </div>

        {/* Main Header / Nav */}
        <header className="new-main-header">
          <div className="new-nav-bg-slant"></div>
          <div className="new-nav-container">
            <a href="/" className="mobile-only-logo">
              <span>Gokab</span>
            </a>
            <nav className={`new-nav-links ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
              <a href="#home" className={`new-nav-link ${activeTab === 'home' ? 'active' : ''}`} onClick={handleRedirect('#home', 'home')}>Home</a>
              <Link to="/about" className={`new-nav-link ${activeTab === 'about' ? 'active' : ''}`} onClick={() => { setActiveTab('about'); setIsMobileMenuOpen(false); }}>Company</Link>
              <Link to="/services" className={`new-nav-link ${activeTab === 'services' ? 'active' : ''}`} onClick={() => { setActiveTab('services'); setIsMobileMenuOpen(false); }}>Our Taxi</Link>
              <Link to="/faq" className={`new-nav-link ${activeTab === 'faq' ? 'active' : ''}`} onClick={() => { setActiveTab('faq'); setIsMobileMenuOpen(false); }}>FAQs</Link>
              <Link to="/blog" className={`new-nav-link ${activeTab === 'blog' ? 'active' : ''}`} onClick={() => { setActiveTab('blog'); setIsMobileMenuOpen(false); }}>Blog</Link>
              <Link to="/contact" className={`new-nav-link ${activeTab === 'contact' ? 'active' : ''}`} onClick={() => { setActiveTab('contact'); setIsMobileMenuOpen(false); }}>Contact</Link>
              <Link to="/login" className={`new-nav-link ${activeTab === 'login' ? 'active' : ''}`} onClick={() => { setActiveTab('login'); setIsMobileMenuOpen(false); }}>Login</Link>
            </nav>
            <div className="new-nav-actions">
              <button className="new-login-btn hidden-mobile" onClick={() => navigate('/login')}>Login</button>
              <button className="new-book-btn hidden-mobile" onClick={() => window.open('https://play.google.com/store/apps/details?id=com.gokab.user', '_blank')}>Book a Taxi</button>
              <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                ☰
              </button>
            </div>
          </div>
        </header>

        {/* Hero Content */}
        <section id="home" className="new-hero-section">
          <div className="new-hero-left">
            <span className="new-hero-subtitle">Travel securely with us!</span>
            <h1 className="new-hero-title">Book your taxi from<br />anywhere today!</h1>
            <p className="new-hero-desc">Everything your taxi business needs is already here!<br />Gokab made for taxi service companies!</p>
            <div className="new-hero-cta-row">
              <button className="new-hero-action-btn" onClick={() => window.open('https://play.google.com/store/apps/details?id=com.gokab.user', '_blank')}>Book Your Ride</button>
              <button className="new-hero-login-btn" onClick={() => navigate('/login')}>
                <LogIn size={18} />
                <span>Login</span>
              </button>
            </div>
          </div>

          <div className="new-hero-graphic">
            <div className="new-hero-ribbon"></div>
            <img src={newHeroTaxiImg} alt="Taxi" className="new-hero-taxi" />
          </div>


        </section>
      </div>

      {/* Services Section */}
      <section id="services" className="subscriptions-section">
        <div className="section-header">
          <h2 className="section-title">OUR SERVICES</h2>
          <div className="section-triangle"></div>
        </div>

        <div className="subscriptions-grid">
          {/* Card 1 */}
          <div className="sub-card yellow">
            <h3>TAXI SERVICE</h3>
            <p>Comfortable and safe city rides to any destination you want to go with our professional drivers.</p>
            <div className="sub-card-image">
              <img src={rideImg} alt="City Taxi" />
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="benefits-section">
        <div className="benefits-container">
          <div className="section-header">
            <h2 className="section-title">SOME BENEFITS</h2>
            <div className="section-triangle"></div>
          </div>

          <div className="benefits-grid">
            <div className="benefit-item">
              <div className="benefit-icon">
                <Home strokeWidth={2.5} />
              </div>
              <div className="benefit-content">
                <h3>HOME PICKUP</h3>
                <p>We run do home pickup to serve you more better and to your convenience</p>
              </div>
            </div>

            <div className="benefit-item">
              <div className="benefit-icon">
                <Gift strokeWidth={2.5} />
              </div>
              <div className="benefit-content">
                <h3>BONUSES FOR RIDE</h3>
                <p>When you book us frequently we give you different bonuses that can put a smile on your face</p>
              </div>
            </div>

            <div className="benefit-item">
              <div className="benefit-icon">
                <Clock strokeWidth={2.5} />
              </div>
              <div className="benefit-content">
                <h3>FAST BOOKING</h3>
                <p>Our book method is very fast and easy. It won't stress you.</p>
              </div>
            </div>

            <div className="benefit-item">
              <div className="benefit-icon">
                <Map strokeWidth={2.5} />
              </div>
              <div className="benefit-content">
                <h3>GPS SEARCHING</h3>
                <p>We run GPS searching incase you aren't sure of your destination. So you don't have to worry.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-login-section">
        <div className="landing-login-card">
          <div className="landing-login-copy">
            <p className="landing-login-eyebrow">Account Access</p>
            <h2>Login from the homepage to manage rides, bookings, refunds, and support requests.</h2>
            <p>
              Sign in to view trip history, track active services, update your account,
              and reach support faster from one place.
            </p>
          </div>
          <div className="landing-login-actions">
            <button className="landing-login-primary" onClick={() => navigate('/login')}>
              <LogIn size={18} />
              <span>Go to Login</span>
            </button>
            <button className="landing-login-secondary" onClick={() => navigate('/signup')}>
              Create Account
            </button>
          </div>
        </div>
      </section>

      {/* Check Us Out Section */}
      <section className="check-us-out-section" style={{ padding: '80px 5%' }}>
        <div className="section-header">
          <h2 className="section-title">CHECK US OUT</h2>
          <div className="section-triangle"></div>
        </div>

        <div style={{
          marginTop: '40px',
          background: '#fff',
          borderRadius: '30px',
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0,0,0,0.1)',
          display: 'flex',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: '1 1 500px', height: '400px', overflow: 'hidden' }}>
            {/* <img src={checkUsOutImg} alt="Check Us Out" style={{ width: '100%', height: '100%', objectCover: 'cover' }} /> */}
          </div>
          <div style={{ flex: '1 1 400px', padding: '60px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h3 style={{ fontSize: '32px', fontWeight: '800', color: '#1a1a1a', marginBottom: '20px' }}>Join the Gokab Community</h3>
            <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.8', marginBottom: '30px' }}>
              Follow us on social media to get the latest updates, exclusive offers, and behind-the-scenes content.
              Be part of the fastest growing transportation network in the region.
            </p>
            <div style={{ display: 'flex', gap: '15px', marginBottom: '40px' }}>
              <a href="#" style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}><Camera size={24} /></a>
              <a href="#" style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}><PlayCircle size={24} /></a>
              <a href="#" style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}><Share2 size={24} /></a>
            </div>
            <div className="check-us-out-links">
              {appLinks.map((link, index) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`check-us-out-link ${index === 0 ? 'primary' : 'secondary'}`}
                >
                  <Download size={18} />
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer Section (New) */}
      <footer id="contact" className="new-landing-footer">
        <div className="footer-newsletter-banner">
          <div className="newsletter-image">
            <img src={heroImg} alt="Subscribe" />
          </div>
          <div className="newsletter-content">
            <div className="newsletter-bg-slant"></div>
            <div className="newsletter-text">
              <h4 className="newsletter-subtitle"><Car size={16} /> GET TO ACCESS</h4>
              <h3 className="newsletter-title">Subscribe Our Newsletter.</h3>
              <form className="newsletter-form">
                <input type="email" placeholder="Email" />
                <button type="button" onClick={() => window.open('https://play.google.com/store/apps/details?id=com.gokab.user', '_blank')}>Book Now →</button>
              </form>
            </div>
          </div>
        </div>

        <div className="footer-main-content">
          <div className="footer-col-1">
            <a href="/" className="footer-logo">
              <span style={{ color: 'var(--primary-brand)', fontSize: '2.5rem', fontWeight: 800 }}>Gokab</span><span style={{ color: '#fff', fontSize: '2.5rem', fontWeight: 800 }}>24</span>
            </a>
            <p>We provide the best taxi and ride services in the region. Reliable, fast, and secure rides at your fingertips.</p>
            <p>Our fleet consists of well-maintained vehicles driven by professional drivers to ensure a comfortable journey.</p>
            <div className="footer-socials">
              <a href="#" className="social-icon">f</a>
              <a href="#" className="social-icon">t</a>
              <a href="#" className="social-icon">in</a>
              <a href="#" className="social-icon">y</a>
            </div>
            <div className="footer-website">www.gokab.com</div>
          </div>
          <div className="footer-col-2">
            <h3>Quick Links</h3>
            <ul>
              <li><Link to="/terms">Terms & Conditions</Link></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
              <li><Link to="/refund">Refund Policy</Link></li>
              <li><Link to="/cancellation">Cancellation Policy</Link></li>
              <li><Link to="/contact">Contact Us</Link></li>
              <li><Link to="/about">About Us</Link></li>
            </ul>
          </div>
          <div className="footer-col-3">
            <h3>Our Services</h3>
            <ul>
              <li><Link to="/services">City Rides</Link></li>
              <li><Link to="/services">Airport transfers</Link></li>
              <li><Link to="/services">Outstation Trips</Link></li>
              <li><Link to="/contact">24/7 Customer Support</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom-bar">
          <div className="footer-legal">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms & Conditions</Link>
          </div>
          <div className="footer-copyright">
            Copyright 2026 © All Right Reserved Design by Gokab
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
