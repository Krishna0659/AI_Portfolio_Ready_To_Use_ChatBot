'use client';

import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function StoryMotion({ reduced }: { reduced: boolean }) {
  useEffect(() => {
    if (reduced) return;
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.lp-showcase figure').forEach((figure, index) => {
        gsap.fromTo(figure, { y: 90, rotateX: 7, skewY: index ? -2 : 2 }, {
          y: 0, rotateX: 0, skewY: 0, ease: 'none',
          scrollTrigger: { trigger: figure, start: 'top bottom', end: 'top 35%', scrub: true },
        });
      });
      gsap.to('.lp-hero h1', {
        y: -90, skewY: -3, opacity: 0, ease: 'none',
        scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom 30%', scrub: true },
      });
      gsap.utils.toArray<HTMLElement>('.lp-approach, .lp-review').forEach(section => {
        gsap.fromTo(section.querySelectorAll('h2, p'), { y: 75, opacity: 0 }, {
          y: 0, opacity: 1, stagger: .12, ease: 'none',
          scrollTrigger: { trigger: section, start: 'top 75%', end: 'top 25%', scrub: true },
        });
      });
      gsap.fromTo('.lp-portal', { clipPath: 'circle(0% at 50% 50%)' }, {
        clipPath: 'circle(150% at 50% 50%)', ease: 'power2.in',
        scrollTrigger: { trigger: '.lp-story', start: 'bottom 145%', end: 'bottom 100%', scrub: true },
      });
    });
    return () => context.revert();
  }, [reduced]);
  return <div className="lp-portal" aria-hidden="true" />;
}
